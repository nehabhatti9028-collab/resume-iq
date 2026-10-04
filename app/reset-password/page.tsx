'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(''); setMessage('')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    const { error: authError } = await createClient().auth.updateUser({ password })
    setBusy(false)
    if (authError) { console.error('[v0] password update failed', authError); setError('We could not update your password. Please request a new link.'); return }
    setMessage('Password updated. You can return to ResumeIQ and sign in.')
  }
  return <main className="auth-page"><div className="auth-card"><div className="wordmark">ResumeIQ</div><h1>Choose a new password.</h1><p>Use at least 8 characters to keep your account secure.</p><form onSubmit={updatePassword}><label>New password<input type="password" minLength={8} required value={password} onChange={event=>setPassword(event.target.value)} /></label>{error&&<div className="error">{error}</div>}{message&&<div className="notice">{message}</div>}<button className="primary-button" disabled={busy}>{busy?'Updating…':'Update password'} <ArrowRight /></button></form></div></main>
}
