export function getLanguageDisplayName(code?: string | null) {
  if (!code) return ''
  const normalized = code.replace(/_/g, '-')
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })
    return displayNames.of(normalized) || code
  } catch {
    return code
  }
}
