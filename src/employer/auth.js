const EMPLOYER_AUTH_STORAGE_KEY = 'tarborojobs_employer_auth_token'

export function getStoredEmployerToken() {
  return localStorage.getItem(EMPLOYER_AUTH_STORAGE_KEY) || ''
}

export function setStoredEmployerToken(token) {
  localStorage.setItem(EMPLOYER_AUTH_STORAGE_KEY, token)
}

export function clearStoredEmployerToken() {
  localStorage.removeItem(EMPLOYER_AUTH_STORAGE_KEY)
}

export { EMPLOYER_AUTH_STORAGE_KEY }