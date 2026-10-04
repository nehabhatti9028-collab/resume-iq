import { createClient } from '@/lib/supabase/server'
import { generateText } from 'ai'
import mammoth from 'mammoth'
export const runtime = 'nodejs'

function cleanJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] || value).trim()
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Please sign in before analyzing a resume.' }, { status: 401 })
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Choose a PDF or DOCX resume.' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: 'This file is over 10MB. Choose a smaller resume.' }, { status: 400 })
  if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)) return Response.json({ error: 'Only PDF and DOCX files are supported.' }, { status: 400 })

  const path = `${user.id}/${crypto.randomUUID()}-${file.name}`
  const upload = await supabase.storage.from('resume-uploads').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return Response.json({ error: 'We could not securely upload this file. Please try again.' }, { status: 500 })
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    let extracted: string
    if (file.type === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      extracted = (await parser.getText()).text
      await parser.destroy()
    } else {
      extracted = (await mammoth.extractRawText({ buffer })).value
    }
    const resumeText = extracted.replace(/\s+/g, ' ').trim()
    if (resumeText.length < 80) return Response.json({ error: 'This resume appears unreadable or scanned. Upload a text-based PDF or DOCX.' }, { status: 422 })
    const result = await generateText({
      model: 'openai/gpt-4o-mini',
      prompt: `Analyze this resume. Return ONLY valid JSON with keys score (integer 0-100), summary (string), strengths (array of strings), opportunities (array of strings), keywords (array of strings), comments (array of objects with line (string copied from resume), label (Strength or Improve), suggestion (string)). Keep it concise and grounded in the resume. Resume: ${resumeText}`,
    })
    const analysis = JSON.parse(cleanJson(result.text))
    const { data, error } = await supabase.from('resume_analyses').insert({ user_id: user.id, file_name: file.name, resume_text: resumeText, score: Math.max(0, Math.min(100, Number(analysis.score))), summary: analysis.summary, strengths: analysis.strengths, opportunities: analysis.opportunities, keywords: analysis.keywords, comments: analysis.comments }).select('id,file_name,resume_text,score,summary,strengths,opportunities,keywords,comments,created_at').single()
    if (error) throw error
    return Response.json(data)
  } catch (error) {
    console.error('[v0] resume analysis failed', error)
    return Response.json({ error: 'We could not analyze this file. Please try a text-based PDF or DOCX and try again.' }, { status: 502 })
  } finally {
    await supabase.storage.from('resume-uploads').remove([path])
  }
}

