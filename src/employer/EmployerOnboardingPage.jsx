import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert, Lock } from 'lucide-react'
import { setStoredEmployerToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

export default function EmployerOnboardingPage({
  onBusinessCreated,
  setCurrentPage,
  onAuthComplete,
  SectionHeader,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  employerIndustries,
}) {
  const [token] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('token') || ''
  })

  const [tokenLoading, setTokenLoading] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [employerPreview, setEmployerPreview] = useState(null)

  const [formData, setFormData] = useState({
    business_name: '',
    contact_name: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    city: 'Tarboro, NC',
    notes: '',
    password: '',
    confirm_password: '',
  })

  const [industry, setIndustry] = useState('')
  const [isHiring, setIsHiring] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setTokenError('Missing onboarding token.')
        setTokenValid(false)
        setTokenLoading(false)
        return
      }

      try {
        const response = await fetch(
          `${API_BASE}/employer-onboarding/validate?token=${encodeURIComponent(token)}`
        )
        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Invalid onboarding token.')
        }

        setEmployerPreview(data.employer || null)
        setFormData((prev) => ({
          ...prev,
          business_name: data.employer?.business_name || '',
          email: data.employer?.email || '',
        }))
        setTokenValid(true)
        setTokenError('')
      } catch (err) {
        setTokenValid(false)
        setTokenError(err.message || 'Invalid onboarding token.')
      } finally {
        setTokenLoading(false)
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

      if (formData.password !== formData.confirm_password) {
        throw new Error('Passwords do not match.')
      }

      const response = await fetch(`${API_BASE}/employer-onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          business_name: formData.business_name,
          industry,
          contact_name: formData.contact_name,
          email: formData.email,
          phone: formData.phone,
          website: formData.website,
          address: formData.address,
          city: formData.city,
          notes: formData.notes,
          is_hiring: isHiring,
          password: formData.password,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to complete employer setup.')
      }

      setMessage('Employer setup completed successfully.')

      if (data.auth_token) {
        setStoredEmployerToken(data.auth_token)
        if (onAuthComplete) {
          await onAuthComplete(data.auth_token)
        }
      }

      if (onBusinessCreated) {
        onBusinessCreated()
      }

      setTimeout(() => {
        setCurrentPage('employer-dashboard')
        const url = new URL(window.location.href)
        url.searchParams.delete('page')
        url.searchParams.delete('token')
        window.history.replaceState({}, '', url.pathname + url.search)
      }, 1500)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (tokenLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <SectionHeader
          title="Complete Employer Setup"
          subtitle="Validating your onboarding access"
        />
        <Card title="Checking Access">
          <p className="text-sm text-slate-600">
            Please wait while we validate your onboarding token...
          </p>
        </Card>
      </div>
    )
  }

  if (!tokenValid) {
    return (
      <div className="mx-auto max-w-3xl">
        <SectionHeader
          title="Access Denied"
          subtitle="This onboarding link is invalid, expired, or already used"
        />
        <Card title="Onboarding Access Required">
          <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Unable to continue</div>
              <p className="mt-1">
                {tokenError || 'You need a valid employer onboarding link to access this page.'}
              </p>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={() => setCurrentPage('list-business')}
              className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            >
              Go to Employer Plan
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader
        title="Complete Employer Setup"
        subtitle="Finish your business details and create your employer login. Your email address will be your username."
      />

      <div className="mb-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Access approved</div>
            <p className="mt-1">
              Subscription status:{' '}
              <span className="font-medium">
                {employerPreview?.subscription_status || 'active'}
              </span>
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Employer Details">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Business Name" required>
              <Input
                name="business_name"
                value={formData.business_name}
                onChange={handleChange}
                placeholder="Your business name"
                required
              />
            </Field>

            <Field label="Industry" required>
              <Select value={industry} onChange={(e) => setIndustry(e.target.value)} required>
                <option value="" disabled>
                  Select industry
                </option>
                {employerIndustries.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Contact Name" required>
              <Input
                name="contact_name"
                value={formData.contact_name}
                onChange={handleChange}
                placeholder="Who should we contact?"
                required
              />
            </Field>

            <Field label="Email Address / Username" required>
              <Input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="contact@yourbusiness.com"
                required
              />
            </Field>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Phone Number">
              <Input
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="(252) 555-0100"
              />
            </Field>

            <Field label="Website">
              <Input
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="https://yourbusiness.com"
              />
            </Field>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="City">
              <Input
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="Tarboro, NC"
              />
            </Field>

            <Field label="Address">
              <Input
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="123 Main St, Tarboro, NC"
              />
            </Field>
          </div>

          <Field label="About Your Business">
            <Textarea
              name="notes"
              rows={5}
              value={formData.notes}
              onChange={handleChange}
              placeholder="Tell job seekers about your business..."
            />
          </Field>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-semibold">Login details:</span> Use your email address as your
            username when signing in later.
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Create Password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="At least 8 characters"
                  required
                  className="pl-10"
                />
              </div>
            </Field>

            <Field label="Confirm Password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  name="confirm_password"
                  type="password"
                  value={formData.confirm_password}
                  onChange={handleChange}
                  placeholder="Re-enter your password"
                  required
                  className="pl-10"
                />
              </div>
            </Field>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-lg font-semibold text-slate-900">Currently Hiring?</div>
                <p className="mt-1 text-sm text-slate-500">
                  Display a “Hiring” badge on your listing after approval
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsHiring((prev) => !prev)}
                className={`relative h-8 w-14 rounded-full p-1 transition ${
                  isHiring ? 'bg-emerald-600' : 'bg-slate-200 hover:bg-slate-300'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-full bg-white shadow-sm transition ${
                    isHiring ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {message && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Submitting...' : 'Complete Employer Setup'}
            </button>
          </div>
        </Card>
      </form>
    </div>
  )
}