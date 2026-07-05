function str(s: unknown): string | null {
  return typeof s === "string" ? s : null
}

export function sanitizeEmail(email: unknown): string | null {
  const s = str(email)
  if (!s) return null
  const trimmed = s.toLowerCase().trim()
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

export function sanitizeUsername(username: unknown): string | null {
  const s = str(username)
  if (!s) return null
  const trimmed = s.trim()
  return trimmed && trimmed.length <= 50 ? trimmed : null
}

export function sanitizePassword(password: unknown): string | null {
  const s = str(password)
  if (!s) return null
  return s.length >= 6 && s.length <= 128 ? s : null
}
