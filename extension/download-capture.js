/**
 * Candidate selection for dsh_browser_capture_download.
 *
 * The extension records candidates from four capture sources while it clicks:
 * Chrome downloads, tabs the click opens, page-created blobs, and network
 * responses. This module decides which recorded candidate is the file the user
 * asked for, without touching any Chrome API, so the rules are unit-tested.
 *
 * A candidate is `{ via, url, contentType, mimeType, bytes, observedAt }`:
 * `via` names the source, `url` is the observed URL when there is one (never
 * returned to the model), and the content type is known for blobs, network
 * responses, and downloads with a sniffed type. `accept` is a list of MIME
 * types (matched as a prefix, ignoring parameters) or extensions such as
 * ".zip" (matched as the end of the URL path's file name); without it, a file
 * is accepted unless it is an HTML page, JSON, or JavaScript.
 */

/** A content type without its parameters, lowercased, for comparison. */
function baseMimeType(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * Whether a content type is a web page or code, which is never the file a
 * download button produces. An unknown type is not rejected: most downloadable
 * files are served as octet-stream or with no type at all.
 */
export function isRejectedMimeType(contentType) {
  const mime = baseMimeType(contentType)
  if (mime === '') return false
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return true
  if (mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json')) return true
  return mime === 'application/javascript' || mime === 'text/javascript'
    || mime === 'application/x-javascript' || mime === 'application/ecmascript'
    || mime === 'text/ecmascript' || mime === 'application/x-ecmascript'
}

/** The last path segment of a candidate's URL, decoded, or "" when there is none. */
export function candidateFileName(candidate) {
  if (typeof candidate?.filename === 'string' && candidate.filename !== '') return candidate.filename
  if (typeof candidate?.url !== 'string' || candidate.url === '') return ''
  try {
    const url = new URL(candidate.url)
    // A blob: URL's path is the inner URL; its last segment is a random UUID.
    const pathname = url.protocol === 'blob:' ? new URL(url.pathname).pathname : url.pathname
    const last = pathname.split('/').filter(Boolean).pop()
    if (last === undefined) return ''
    try { return decodeURIComponent(last) } catch { return last }
  } catch {
    return ''
  }
}

/** Normalize one accept entry: ".zip" or "zip" is an extension, otherwise a MIME type. */
function acceptEntry(value) {
  const entry = String(value ?? '').trim().toLowerCase()
  if (entry === '') return undefined
  if (entry.includes('/')) return { mime: baseMimeType(entry) }
  return { extension: entry.startsWith('.') ? entry : '.' + entry }
}

/**
 * Whether one recorded candidate matches the requested accept list.
 *
 * With no `accept`, everything except HTML, JSON, and JavaScript is accepted.
 * With one, a MIME entry matches when it is a prefix of the candidate's content
 * type (so "application/" accepts every application type), and an extension
 * entry matches when the candidate's URL file name ends with it.
 */
export function matchesAccept(candidate, accept) {
  if (candidate === null || typeof candidate !== 'object') return false
  const contentType = baseMimeType(candidate.contentType ?? candidate.mimeType)
  const entries = Array.isArray(accept)
    ? accept.map(acceptEntry).filter(entry => entry !== undefined)
    : []
  if (entries.length === 0) return !isRejectedMimeType(contentType)
  const fileName = candidateFileName(candidate).toLowerCase()
  for (const entry of entries) {
    if (entry.mime !== undefined) {
      if (contentType !== '' && contentType.startsWith(entry.mime)) return true
    } else if (fileName !== '' && fileName.endsWith(entry.extension)) {
      return true
    }
  }
  return false
}

/**
 * Pick the file to save from the candidates recorded during one capture.
 *
 * Candidates are ranked by `observedAt` (ties keep their recorded order), so
 * the first file the click produced wins. Returns `{ selected, also }`:
 * `selected` is the winning candidate or undefined, and `also` describes the
 * other acceptable files seen in the capture window as `{ via, contentType,
 * bytes }` (the bytes count is omitted when unknown). One file can be seen by
 * two sources (an anchor and its download), so `also` keeps the first candidate
 * per `keyOf` identity and stops at `maxAlso` entries.
 */
export function selectDownloadCandidate(candidates, { accept, maxAlso = 10, keyOf = candidateKey } = {}) {
  const recorded = Array.isArray(candidates) ? candidates : []
  const acceptable = recorded
    .map((candidate, position) => ({
      candidate,
      position,
      observedAt: Number.isFinite(candidate?.observedAt) ? candidate.observedAt : 0,
    }))
    .filter(entry => matchesAccept(entry.candidate, accept))
    .sort((left, right) => left.observedAt - right.observedAt || left.position - right.position)
    .map(entry => entry.candidate)
  const [selected, ...rest] = acceptable
  const seen = new Set(selected === undefined ? [] : [keyOf(selected)])
  const also = []
  for (const candidate of rest) {
    if (also.length >= maxAlso) break
    const key = keyOf(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    also.push({
      via: candidate.via,
      contentType: candidate.contentType ?? candidate.mimeType ?? '',
      ...(Number.isSafeInteger(candidate.bytes) && candidate.bytes >= 0 ? { bytes: candidate.bytes } : {}),
    })
  }
  return { selected, also }
}

/** Identity of one file, so a URL and the download it triggered count once. */
export function candidateKey(candidate) {
  if (typeof candidate?.url === 'string' && candidate.url !== '') return candidate.url
  return String(candidate?.via ?? '') + ':' + String(candidate?.contentType ?? '')
    + ':' + String(candidate?.bytes ?? '')
}
