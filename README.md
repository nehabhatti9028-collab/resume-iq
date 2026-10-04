# ResumeIQ

AI-powered resume analysis platform that helps job seekers understand the quality of their resume and identify areas for improvement.

## 🚀 Live Demo

Coming soon...

## ✨ Features

- 📄 Upload PDF or DOCX resumes
- 🤖 AI-powered resume analysis
- 📊 Resume score from 0–100
- 💪 Identify resume strengths
- 🎯 Get improvement suggestions
- 🔑 Extract relevant resume keywords
- 💬 Detailed resume comments
- 🔐 Secure user authentication with Supabase
- ☁️ Secure resume upload storage
- 🗄️ Save analysis results for each user
- 📱 Responsive and modern UI

## 🛠️ Tech Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Lucide React

### Backend
- Next.js API Routes
- Node.js
- PDF text extraction
- DOCX text extraction

### AI
- Google Gemini API

### Database & Authentication
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Row Level Security (RLS)

## 📂 Project Structure

```text
resume-iq/
├── app/
│   ├── api/
│   │   └── analyze/
│   │       └── route.ts
│   └── ...
├── components/
├── lib/
│   └── supabase/
├── public/
├── .env.local
├── package.json
├── tsconfig.json
└── README.md
