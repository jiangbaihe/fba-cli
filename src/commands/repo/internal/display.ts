export function redactUrlCredentials(value: string | null | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    if (!url.username && !url.password) return value

    url.username = '***'
    url.password = ''
    return url.toString()
  } catch {
    return value.replace(/^(https?:\/\/)[^/@\s]+@/i, '$1***@')
  }
}

export function redactSensitiveText(value: string): string {
  return (redactUrlCredentials(value) ?? value)
    .replace(/\b(https?:\/\/)[^/@\s]+@/gi, '$1***@')
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s]+/gi, '$1***')
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '***')
}

export function formatErrorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error))
}
