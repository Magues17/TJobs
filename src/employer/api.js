import { getStoredEmployerToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

function parseJsonResponse(text) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Server returned non-JSON response: ${text.slice(0, 160)}`)
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const data = parseJsonResponse(text)

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed.')
  }

  return data
}

function buildAuthHeaders(tokenOverride, includeJson = true) {
  const token = tokenOverride || getStoredEmployerToken()
  const headers = {}

  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export async function employerLogin(payload) {
  return requestJson(`${API_BASE}/employer-auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function requestEmployerPasswordReset(payload) {
  return requestJson(`${API_BASE}/employer-auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function validateEmployerPasswordResetToken(token) {
  return requestJson(`${API_BASE}/employer-auth/reset-password/validate?token=${encodeURIComponent(token)}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export async function resetEmployerPassword(payload) {
  return requestJson(`${API_BASE}/employer-auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function loadEmployerSession(tokenOverride) {
  return requestJson(`${API_BASE}/employer-auth/me`, {
    headers: buildAuthHeaders(tokenOverride, false),
  })
}

export async function updateEmployerAccount(tokenOverride, payload) {
  return requestJson(`${API_BASE}/employer/account`, {
    method: 'PATCH',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify(payload),
  })
}

export async function updateEmployerPassword(tokenOverride, payload) {
  return requestJson(`${API_BASE}/employer/account/password`, {
    method: 'PATCH',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify(payload),
  })
}

export async function loadEmployerJobs(tokenOverride) {
  return requestJson(`${API_BASE}/employer/jobs`, {
    headers: buildAuthHeaders(tokenOverride, false),
  })
}

export async function loadEmployerStats(tokenOverride) {
  return requestJson(`${API_BASE}/employer/stats`, {
    headers: buildAuthHeaders(tokenOverride, false),
  })
}

export async function createEmployerJob(tokenOverride, payload) {
  return requestJson(`${API_BASE}/employer/jobs`, {
    method: 'POST',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify(payload),
  })
}

export async function updateEmployerJob(tokenOverride, jobId, payload) {
  return requestJson(`${API_BASE}/employer/jobs/${jobId}`, {
    method: 'PATCH',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify(payload),
  })
}

export async function updateEmployerJobStatus(tokenOverride, jobId, status) {
  return requestJson(`${API_BASE}/employer/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify({ status }),
  })
}

export async function deleteEmployerJob(tokenOverride, jobId) {
  return requestJson(`${API_BASE}/employer/jobs/${jobId}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(tokenOverride, false),
  })
}

export async function loadEmployerResumes(tokenOverride, filters = {}) {
  const params = new URLSearchParams()
  params.set('page', String(filters.page || 1))
  params.set('limit', String(filters.limit || 25))

  if (filters.search) params.set('search', filters.search)
  if (filters.city) params.set('city', filters.city)
  if (filters.employment_type) params.set('employment_type', filters.employment_type)
  if (filters.candidate_status) params.set('candidate_status', filters.candidate_status)

  return requestJson(`${API_BASE}/employer/resumes?${params.toString()}`, {
    headers: buildAuthHeaders(tokenOverride, false),
  })
}

export async function loadSavedCandidates(tokenOverride, filters = {}) {
  return loadEmployerResumes(tokenOverride, {
    ...filters,
    candidate_status: 'saved',
  })
}

export async function saveCandidateAction(tokenOverride, payload = {}) {
  return requestJson(`${API_BASE}/employer/candidate-actions`, {
    method: 'POST',
    headers: buildAuthHeaders(tokenOverride, true),
    body: JSON.stringify({
      job_seeker_id: payload.job_seeker_id,
      status: payload.status || null,
      notes: payload.notes || null,
      contacted_at: payload.contacted_at || null,
      interview_at: payload.interview_at || null,
      hired_at: payload.hired_at || null,
      rejected_at: payload.rejected_at || null,
      next_follow_up_at: payload.next_follow_up_at || null,
    }),
  })
}