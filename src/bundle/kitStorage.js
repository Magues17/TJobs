// Where the Job Seeker Kit token is remembered so a returning buyer needn't paste it.
export const KIT_STORAGE_KEY = 'tarborojobs_kit_token'

export function getStoredKitToken() {
  try { return localStorage.getItem(KIT_STORAGE_KEY) || '' } catch { return '' }
}

export function storeKitToken(token) {
  try { localStorage.setItem(KIT_STORAGE_KEY, token) } catch { /* storage blocked */ }
}
