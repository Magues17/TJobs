import { useState } from 'react'
import { Lock } from 'lucide-react'
import { employerLogin } from './api'
import { setStoredEmployerToken } from './auth'

export default function EmployerLoginPage({
  setCurrentPage,
  onLoginSuccess,
  SectionHeader,
  Card,
  Field,
  Input,
}) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function handleChange(e) {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const data = await employerLogin(formData)
      setStoredEmployerToken(data.auth_token)

      if (onLoginSuccess) {
        await onLoginSuccess(data.auth_token)
      }

      setCurrentPage('employer-dashboard')
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        title="Employer Login"
        subtitle="Sign in to manage your business profile, jobs, and resumes. Your email address is your username."
      />

      <Card title="Sign In">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-semibold">Username:</span> Use the same email address you entered during employer setup.
          </div>

          <Field label="Email Address / Username" required>
            <Input
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@yourbusiness.com"
              required
            />
          </Field>

          <Field label="Password" required>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter your password"
                required
                className="pl-10"
              />
            </div>
          </Field>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCurrentPage('employer-forgot-password')}
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Forgot your password?
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage('list-business')}
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Need an employer plan?
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}