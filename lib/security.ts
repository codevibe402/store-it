export function sanitizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null
  const trimmed = email.toLowerCase().trim()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

export function sanitizeUsername(username: unknown): string | null {
  if (typeof username !== "string") return null
  const trimmed = username.trim()
  if (!trimmed || trimmed.length > 50) return null
  return trimmed
}

export function sanitizePassword(password: unknown): string | null {
  if (typeof password !== "string") return null
  if (password.length < 6 || password.length > 128) return null
  return password
}
