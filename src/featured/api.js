import { getStoredAdminApiKey } from '../admin/auth'
import { getStoredEmployerToken } from '../employer/auth'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

async function requestJson(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.success) throw new Error(data.error || 'Request failed.')
  return data
}

function employerHeaders() {
  const token = getStoredEmployerToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function adminHeaders() {
  const apiKey = getStoredAdminApiKey()
  return apiKey ? { 'x-admin-key': apiKey } : employerHeaders()
}

export const startFeaturedCheckout = (jobId, weeks) =>
  requestJson(`/employer/jobs/${encodeURIComponent(jobId)}/feature`, { method: 'POST', body: { weeks }, headers: employerHeaders() })

export const submitClaimRequest = (jobId, form) =>
  requestJson(`/jobposts/${encodeURIComponent(jobId)}/claim`, { method: 'POST', body: form })

export const loadFeaturedOrders = () => requestJson('/admin/featured-orders', { headers: adminHeaders() })
export const loadClaimRequests = () => requestJson('/admin/claims', { headers: adminHeaders() })
export const approveClaim = (id) => requestJson(`/admin/claims/${id}/approve`, { method: 'POST', body: {}, headers: adminHeaders() })
export const rejectClaim = (id, reason) => requestJson(`/admin/claims/${id}/reject`, { method: 'POST', body: { reason }, headers: adminHeaders() })
