/** Hostname matching only; path expressions must be reported separately. */
export function tunnelHostnameMatches(
  pattern: string | null | undefined,
  hostname: string,
): boolean {
  if (!pattern) return false
  const normalized = pattern.toLowerCase().replace(/\.$/, '')
  const candidate = hostname.toLowerCase().replace(/\.$/, '')
  return normalized.startsWith('*.')
    ? candidate.endsWith(normalized.slice(1)) && candidate !== normalized.slice(2)
    : normalized === candidate
}
