import { useEffect, useMemo, useState } from 'react'
import {
  resetEmployerPassword,
  validateEmployerPasswordResetToken,
} from './api'

function getResetTokenFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('token') || ''
}

export default function EmployerResetPasswordPage({
  setCurrentPage,
  SectionHeader,
  Card,
  Field,
  Input,
}) {
  const token = useMemo(() => getResetTokenFromUrl(), [])
  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [email, setEmail] = useState('')

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setTokenValid(false)
        setTokenError('Missing reset token.')
        setValidating(false)
        return
      }

      try {
        const data = await validateEmployerPasswordResetToken(token)
        setTokenValid(true)
        setEmail(data.email || '')
      } catch (err) {
        setTokenValid(false)
        setTokenError(err.message || 'This reset link is invalid or expired.')
      } finally {
        setValidating(false)
      }
    }

    validateToken()
  }, [token])

  function handleChange(e) {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      if (formData.password.length < 8) {
        throw new Error('Password must be at least 8 characters.')
      }

      if (formData.password !== formData.confirmPassword) {
        throw new Error('Passwords do not match.')
      }

      const data = await resetEmployerPassword({
        token,
        password: formData.password,
      })

      setMessage(data.message || 'Password reset successfully.')

      setTimeout(() => {
        setCurrentPage('employer-login')
      }, 1500)
    } catch (err) {
      setError(err.message || 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  if (validating) {
    return (
      <div className="mx-auto max-w-xl">
        <SectionHeader
          title="Reset Password"
          subtitle="Checking your reset link..."
        />
        <Card title="Reset Password">
          <p className="text-sm text-slate-400">Validating reset link...</p>
        </Card>
      </div>
    )
  }

  if (!tokenValid) {
    return (
      <div className="mx-auto max-w-xl">
        <SectionHeader
          title="Reset Password"
          subtitle="This password reset link cannot be used."
        />
        <Card title="Reset Password">
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {tokenError || 'This reset link is invalid or expired.'}
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage('employer-forgot-password')}
              className="rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-sm hover:bg-cyan-300"
            >
              Request New Reset Link
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        title="Reset Password"
        subtitle="Choose a new password for your employer account."
      />

      <Card title="Create New Password">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
            Resetting password for <span className="font-semibold">{email || 'your account'}</span>
          </div>

          <Field label="New Password" required>
            <Input
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter a new password"
              required
            />
          </Field>

          <Field label="Confirm New Password" required>
            <Input
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter your new password"
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
              {loading ? 'Saving...' : 'Reset Password'}
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