export function humanizeJobType(value) {
  if (!value) return '—'
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function humanizeStatus(value) {
  if (!value) return '—'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function humanizePayType(value) {
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function resumeFileHref(fileBase, relativePath) {
  if (!relativePath) return ''
  return `${fileBase}${relativePath}`
}