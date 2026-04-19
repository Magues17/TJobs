const ADMIN_API_KEY_STORAGE_KEY = 'tarborojobs_admin_api_key'

export function getStoredAdminApiKey() {
  try {
    return localStorage.getItem(ADMIN_API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setStoredAdminApiKey(value) {
  try {
    if (!value) {
      localStorage.removeItem(ADMIN_API_KEY_STORAGE_KEY)
      return
    }

    localStorage.setItem(ADMIN_API_KEY_STORAGE_KEY, value)
  } catch {
    // ignore localStorage failures
  }
}

export function clearStoredAdminApiKey() {
  try {
    localStorage.removeItem(ADMIN_API_KEY_STORAGE_KEY)
  } catch {
    // ignore localStorage failures
  }
}
