import { getStoredAdminApiKey } from './auth'
import { getStoredEmployerToken } from '../employer/auth'

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

function buildAdminHeaders(apiKeyOverride, includeJson = true) {
  const apiKey = apiKeyOverride || getStoredAdminApiKey()
  const employerToken = !apiKeyOverride && !apiKey ? getStoredEmployerToken() : ''
  const headers = {}

  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }

  if (apiKey) {
    headers['x-admin-key'] = apiKey
  } else if (employerToken) {
    headers.Authorization = `Bearer ${employerToken}`
  }

  return headers
}

export async function loadAdminSession(apiKeyOverride) {
  return requestJson(`${API_BASE}/admin/session`, {
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function loadAdminEmployers(apiKeyOverride) {
  return requestJson(`${API_BASE}/admin/employers`, {
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function loadAdminJobs(apiKeyOverride) {
  return requestJson(`${API_BASE}/admin/jobs`, {
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function loadAdminTokens(apiKeyOverride) {
  return requestJson(`${API_BASE}/admin/tokens`, {
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function createAdminOnboardingToken(apiKeyOverride, payload) {
  return requestJson(`${API_BASE}/employer-onboarding-token`, {
    method: 'POST',
    headers: buildAdminHeaders(apiKeyOverride, true),
    body: JSON.stringify(payload),
  })
}

export async function approveAdminEmployer(apiKeyOverride, employerId) {
  return requestJson(`${API_BASE}/admin/employers/${employerId}/approve`, {
    method: 'POST',
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function deactivateAdminEmployer(apiKeyOverride, employerId) {
  return requestJson(`${API_BASE}/admin/employers/${employerId}/deactivate`, {
    method: 'POST',
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function reactivateAdminEmployer(apiKeyOverride, employerId) {
  return requestJson(`${API_BASE}/admin/employers/${employerId}/reactivate`, {
    method: 'POST',
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function revokeAdminToken(apiKeyOverride, tokenId) {
  return requestJson(`${API_BASE}/admin/tokens/${tokenId}/revoke`, {
    method: 'POST',
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}

export async function deleteAdminJob(apiKeyOverride, jobId) {
  return requestJson(`${API_BASE}/admin/jobs/${jobId}`, {
    method: 'DELETE',
    headers: buildAdminHeaders(apiKeyOverride, false),
  })
}
