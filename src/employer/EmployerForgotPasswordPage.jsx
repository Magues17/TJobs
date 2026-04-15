import { useState } from 'react'
import { requestEmployerPasswordReset } from './api'

export default function EmployerForgotPasswordPage({
  setCurrentPage,
  SectionHeader,
  Card,
  Field,
  Input,
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const data = await requestEmployerPasswordReset({ email })
      setMessage(
        data.message ||
          'If that email exists, a password reset link has been sent.'
      )
    } catch (err) {
      setError(err.message || 'Failed to send reset email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        title="Forgot Password"
        subtitle="Enter your employer login email and we’ll send you a password reset link."
      />

      <Card title="Reset Password">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Employer Email Address" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              required
            />
          </Field>

          {message && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-sm hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage('employer-login')}
              className="text-sm font-medium text-cyan-300 hover:underline"
            >
              Back to login
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}