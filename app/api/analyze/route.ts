import { createClient } from "@/lib/supabase/server";
import mammoth from "mammoth";
import { GoogleGenAI } from "@google/genai";
import { extractText } from "unpdf";

export const runtime = "nodejs";

function parseAIJson(text: string) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Gemini did not return valid JSON.");
  }

  return JSON.parse(
    cleaned.slice(firstBrace, lastBrace + 1)
  );
}

export async function POST(request: Request) {
  let storagePath: string | null = null;

  try {
    // --------------------------------
    // SUPABASE
    // --------------------------------

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        {
          error: "Please sign in before analyzing your resume.",
        },
        { status: 401 }
      );
    }

    // --------------------------------
    // GET FILE
    // --------------------------------

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "Please select a PDF or DOCX resume.",
        },
        { status: 400 }
      );
    }

    // --------------------------------
    // FILE VALIDATION
    // --------------------------------

    if (file.size === 0) {
      return Response.json(
        {
          error: "The selected file is empty.",
        },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return Response.json(
        {
          error: "File size must be less than 10MB.",
        },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        {
          error: "Only PDF and DOCX files are supported.",
        },
        { status: 400 }
      );
    }

    // --------------------------------
    // SUPABASE STORAGE
    // --------------------------------

    storagePath = `${user.id}/${crypto.randomUUID()}-${file.name}`;

    const uploadResult = await supabase.storage
      .from("resume-uploads")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadResult.error) {
      console.error(
        "SUPABASE STORAGE ERROR:",
        uploadResult.error
      );

      return Response.json(
        {
          error:
            "Resume upload failed. Please check Supabase Storage.",
        },
        { status: 500 }
      );
    }

    // --------------------------------
    // READ FILE
    // --------------------------------

    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    let extractedText = "";

    // --------------------------------
    // PDF EXTRACTION
    // --------------------------------

    if (file.type === "application/pdf") {
      try {
        const result = await extractText(
          new Uint8Array(buffer)
        );

        if (Array.isArray(result.text)) {
          extractedText = result.text.join("\n");
        } else {
          extractedText = String(result.text || "");
        }
      } catch (error) {
        console.error(
          "PDF EXTRACTION ERROR:",
          error
        );

        return Response.json(
          {
            error:
              "This PDF could not be read. Please upload a text-based PDF.",
          },
          { status: 422 }
        );
      }
    }

    // --------------------------------
    // DOCX EXTRACTION
    // --------------------------------

    if (
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      try {
        const result =
          await mammoth.extractRawText({
            buffer,
          });

        extractedText = result.value || "";
      } catch (error) {
        console.error(
          "DOCX EXTRACTION ERROR:",
          error
        );

        return Response.json(
          {
            error:
              "This DOCX file could not be read.",
          },
          { status: 422 }
        );
      }
    }

    // --------------------------------
    // CLEAN RESUME TEXT
    // --------------------------------

    const resumeText = extractedText
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    console.log(
      "RESUME TEXT LENGTH:",
      resumeText.length
    );

    // --------------------------------
    // CHECK EXTRACTED TEXT
    // --------------------------------

    if (resumeText.length < 80) {
      return Response.json(
        {
          error:
            "This resume appears to be scanned or unreadable. Please upload a text-based PDF or DOCX.",
        },
        { status: 422 }
      );
    }

    // --------------------------------
    // GEMINI API KEY
    // --------------------------------

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error(
        "GEMINI_API_KEY is missing."
      );

      return Response.json(
        {
          error:
            "Gemini API key is missing. Add GEMINI_API_KEY to .env.local and restart the server.",
        },
        { status: 500 }
      );
    }

    // --------------------------------
    // LIMIT TEXT
    // --------------------------------

    const resumeForAI =
      resumeText.slice(0, 30000);

    let aiText = "";

    // --------------------------------
    // GEMINI AI
    // --------------------------------

    try {
      const ai = new GoogleGenAI({
        apiKey,
      });

      const response =
        await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",

          contents: `
You are an expert technical recruiter.

Analyze the resume provided below.

Return ONLY valid JSON.

Use exactly this structure:

{
  "score": 0,
  "summary": "",
  "strengths": [],
  "opportunities": [],
  "keywords": [],
  "comments": [
    {
      "line": "",
      "label": "Strength",
      "suggestion": ""
    }
  ]
}

Rules:

1. score must be an integer from 0 to 100.
2. summary must be short and professional.
3. strengths must contain 3 useful points.
4. opportunities must contain 3 useful improvement points.
5. keywords must contain relevant resume keywords.
6. comments must contain useful resume observations.
7. label must be exactly "Strength" or "Improve".
8. Do not invent experience.
9. Do not invent education.
10. Do not invent skills.
11. Do not invent achievements.
12. Use ONLY information present in the resume.
13. Return JSON only.
14. Do not use Markdown.
15. Do not add any text outside the JSON.

RESUME:

${resumeForAI}
`,

          config: {
            responseMimeType: "application/json",
          },
        });

      aiText = response.text || "";

      console.log(
        "GEMINI RESPONSE RECEIVED"
      );
    } catch (error) {
      console.error(
        "GEMINI ANALYSIS ERROR:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      return Response.json(
        {
          error: `Gemini Error: ${message}`,
        },
        { status: 502 }
      );
    }

    // --------------------------------
    // PARSE GEMINI JSON
    // --------------------------------

    let analysis: any;

    try {
      analysis = parseAIJson(aiText);
    } catch (error) {
      console.error(
        "GEMINI JSON PARSE ERROR:",
        error
      );

      console.error(
        "GEMINI RAW RESPONSE:",
        aiText
      );

      return Response.json(
        {
          error:
            "Gemini returned an invalid analysis. Please try again.",
        },
        { status: 502 }
      );
    }

    // --------------------------------
    // NORMALIZE DATA
    // --------------------------------

    const score = Math.max(
      0,
      Math.min(
        100,
        Number(analysis.score) || 0
      )
    );

    const summary = String(
      analysis.summary || ""
    );

    const strengths =
      Array.isArray(analysis.strengths)
        ? analysis.strengths.map(String)
        : [];

    const opportunities =
      Array.isArray(
        analysis.opportunities
      )
        ? analysis.opportunities.map(String)
        : [];

    const keywords =
      Array.isArray(analysis.keywords)
        ? analysis.keywords.map(String)
        : [];

    const comments =
      Array.isArray(analysis.comments)
        ? analysis.comments
        : [];

    // --------------------------------
    // SAVE TO SUPABASE DATABASE
    // --------------------------------

    const {
      data,
      error: databaseError,
    } = await supabase
      .from("resume_analyses")
      .insert({
        user_id: user.id,
        file_name: file.name,
        resume_text: resumeText,
        score,
        summary,
        strengths,
        opportunities,
        keywords,
        comments,
      })
      .select(
        `
        id,
        file_name,
        resume_text,
        score,
        summary,
        strengths,
        opportunities,
        keywords,
        comments,
        created_at
        `
      )
      .single();

    if (databaseError) {
      console.error(
        "SUPABASE DATABASE ERROR:",
        databaseError
      );

      return Response.json(
        {
          error:
            "Resume was analyzed, but the result could not be saved.",
        },
        { status: 500 }
      );
    }

    // --------------------------------
    // SUCCESS
    // --------------------------------

    return Response.json(
      data,
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "RESUME ANALYSIS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong.";

    return Response.json(
      {
        error: message,
      },
      { status: 500 }
    );
  } finally {
    // --------------------------------
    // DELETE TEMPORARY STORAGE FILE
    // --------------------------------

    if (storagePath) {
      try {
        const supabase =
          await createClient();

        const { error } =
          await supabase.storage
            .from("resume-uploads")
            .remove([storagePath]);

        if (error) {
          console.error(
            "STORAGE CLEANUP ERROR:",
            error
          );
        }
      } catch (error) {
        console.error(
          "CLEANUP ERROR:",
          error
        );
      }
    }
  }
}