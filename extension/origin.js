export const DEFAULT_DSH_ORIGIN = 'http://127.0.0.1:3080'

/**
 * Normalize a user-supplied DSH Web origin. Loopback hosts may use HTTP or
 * HTTPS; any other host must use HTTPS so the pairing code and session tokens
 * never cross the network in clear text.
 * @param {unknown} value - raw text from Settings or storage.
 * @returns {string | undefined} the canonical origin, or undefined when refused.
 */
export function normalizeDshOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
    if (!loopback && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}
