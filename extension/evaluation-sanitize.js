// Pure post-processing for dsh_browser_evaluate results: elide file-sized payloads,
// mask common token patterns, and cap the serialized result. Kept free of Chrome
// APIs so tests can import it directly (see test/evaluation-sanitize.test.js).
//
// File bytes must never reach the model: a data: URL or a long base64 run is
// replaced with a short marker, and the caller is expected to use
// dsh_browser_save_file (with a page-created blob: URL) to obtain the bytes.

const DEFAULT_MAX_CHARS = 20_000
const MAX_DEPTH = 12
const DATA_URL_MIN_CHARS = 256
const BASE64_RUN_MIN_CHARS = 1_024
const REDACTED = '<redacted>'
const DEPTH_LIMIT = '…[depth limit]'

// A data: URL ends at whitespace, a quote, or markup; the length check keeps
// short inline images unchanged.
const DATA_URL_PATTERN = /data:[^\s"'<>`]+/giu
// Base64 and base64url alphabets. Prose and normal words never reach 1024
// characters without whitespace or punctuation.
const BASE64_RUN_PATTERN = new RegExp('[A-Za-z0-9+/=_-]{' + String(BASE64_RUN_MIN_CHARS) + ',}', 'gu')

// Query parameters whose value is a credential or a short-lived signed value.
const SENSITIVE_QUERY_KEY = 'token|key|secret|password|auth|session|signature|credential|expires'
// Object fields that are always credentials, regardless of their shape.
const SENSITIVE_OBJECT_KEY = /^(?:access_?token|refresh_?token|id_?token|bearer|authorization|api_?key|secret|password|passwd|session_?id)$/iu

/**
 * Sanitize one evaluation value for the model.
 *
 * Strings are rewritten: data: URLs longer than 256 characters become
 * `data:<mime>;base64,…[<n> chars elided]`, base64 runs of at least 1024
 * characters become `…[base64, <n> chars elided]`, and common token patterns
 * (`access_token=…`, `"access_token": "…"`, `Bearer …`, and sensitive query
 * keys such as `token=` or `expires=`) are masked with `<redacted>`.
 * Arrays and plain objects are cloned, never mutated.
 *
 * When the sanitized value serializes to more than `maxChars` characters, the
 * result is `{ valueText, truncated: true, totalChars }`; otherwise it is
 * `{ value, totalChars }`. `elided` and `redacted` are present only when a
 * replacement happened.
 *
 * @param {unknown} value JSON-serializable value returned by page evaluation.
 * @param {{ maxChars?: number }} [options]
 * @returns {{ value?: unknown, valueText?: string, truncated?: true, totalChars: number, elided?: number, redacted?: number }}
 */
export function sanitizeEvaluationValue(value, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const limit = Number.isSafeInteger(maxChars) && maxChars > 0
    ? Math.min(maxChars, 100_000)
    : DEFAULT_MAX_CHARS
  const counts = { elided: 0, redacted: 0 }
  const sanitizedValue = sanitizeValue(value, 0, counts)
  const serialized = JSON.stringify(sanitizedValue)
  const totalChars = serialized === undefined ? 0 : serialized.length
  const extra = {
    ...(counts.elided > 0 ? { elided: counts.elided } : {}),
    ...(counts.redacted > 0 ? { redacted: counts.redacted } : {}),
  }
  if (serialized !== undefined && totalChars > limit) {
    return { valueText: serialized.slice(0, limit), truncated: true, totalChars, ...extra }
  }
  return { value: sanitizedValue, totalChars, ...extra }
}

function sanitizeValue(value, depth, counts) {
  if (typeof value === 'string') return sanitizeString(value, counts)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return DEPTH_LIMIT
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, depth + 1, counts))
  // Values that already have their own JSON shape (Date and friends) are left
  // to JSON.stringify below.
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) return value
  const copy = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    if (SENSITIVE_OBJECT_KEY.test(key) && typeof item === 'string' && item !== '' && item !== REDACTED) {
      counts.redacted += 1
      copy[key] = REDACTED
      continue
    }
    copy[key] = sanitizeValue(item, depth + 1, counts)
  }
  return copy
}

function sanitizeString(text, counts) {
  let result = text
  result = result.replace(DATA_URL_PATTERN, match => {
    if (match.length <= DATA_URL_MIN_CHARS) return match
    counts.elided += 1
    return elideDataUrl(match)
  })
  result = result.replace(BASE64_RUN_PATTERN, match => {
    counts.elided += 1
    return '…[base64, ' + String(match.length) + ' chars elided]'
  })
  return maskTokens(result, counts)
}

function elideDataUrl(dataUrl) {
  const mime = /^data:([^;,]*)/iu.exec(dataUrl)?.[1]?.trim() || 'application/octet-stream'
  const isBase64 = /^data:[^,]*;base64,/iu.test(dataUrl)
  return 'data:' + mime + (isBase64 ? ';base64' : '') + ',…[' + String(dataUrl.length) + ' chars elided]'
}

function maskTokens(text, counts) {
  const mask = pattern => {
    text = text.replace(pattern, (match, prefix, value) => {
      if (value === REDACTED) return match
      counts.redacted += 1
      return prefix + REDACTED
    })
  }
  mask(new RegExp('([?&][^=&#\\s"\'`]*?(?:' + SENSITIVE_QUERY_KEY + ')[^=&#\\s"\'`]*=)([^&#\\s"\'`]*)', 'gi'))
  mask(/(access_token(?:=|%3D))([^&"'\s]+)/gi)
  mask(/(["']access_token["']\s*:\s*["'])([^"']+)/gi)
  mask(/(authorization["']?\s*[:=]\s*["']?bearer\s+)([^"'\s]+)/gi)
  mask(/(\bbearer\s+)([A-Za-z0-9._~+/=-]+)/gi)
  return text
}
