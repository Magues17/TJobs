import { useState } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { loadAdminSession } from './api'
import { setStoredAdminApiKey } from './auth'

export default function AdminLoginPage({
  onLoginSuccess,
  setCurrentPage,
  onOpenDashboard,
  SectionHeader,
  Card,
  Field,
  Input,
}) {
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setError('Enter the admin API key configured on the server.')
      return
    }

    setSubmitting(true)

    try {
      await loadAdminSession(trimmedKey)
      setStoredAdminApiKey(trimmedKey)
      await onLoginSuccess(trimmedKey)
      onOpenDashboard()
    } catch (submitError) {
      setError(submitError.message || 'Admin login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <SectionHeader
        title="Admin access"
        subtitle="Use the server-side admin API key to manage employers, onboarding links, and job moderation from the frontend."
      />

      <Card title="Sign in to the admin dashboard">
        <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
          This page still supports the backend admin key, but your designated admin employer login can also become admin automatically after a normal employer sign-in.
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <Field label="Admin API key" required>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Paste your ADMIN_API_KEY"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className="pl-11"
              />
            </div>
          </Field>

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <ShieldCheck className="h-4 w-4" />
              {submitting ? 'Checking access…' : 'Open dashboard'}
            </button>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setCurrentPage('employer-login')}
                className="text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
              >
                Use employer login
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage('jobs')}
                className="text-sm font-medium text-slate-400 transition hover:text-white"
              >
                Back to public site
              </button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  )
}
