import { extname } from 'node:path'

/**
 * Content checks for files saved from a tab. A file name's extension states
 * what the caller expects; the first bytes show what actually arrived. A
 * mismatch usually means the server sent a sign-in, error, or CAPTCHA page
 * in place of the file, often with HTTP 200.
 */

/** Signature families: what the first bytes of a well-formed file look like. */
const KINDS = {
  // PDF readers accept up to 1024 bytes of leading junk before the header.
  pdf: { label: 'a PDF', extension: '.pdf', test: bytes => Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-') },
  png: { label: 'a PNG image', extension: '.png', test: bytes => startsWith(bytes, '\x89PNG\r\n\x1a\n') },
  jpeg: { label: 'a JPEG image', extension: '.jpg', test: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  gif: { label: 'a GIF image', extension: '.gif', test: bytes => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a') },
  webp: { label: 'a WebP image', extension: '.webp', test: bytes => startsWith(bytes, 'RIFF') && startsWith(bytes.subarray(8), 'WEBP') },
  zip: { label: 'a ZIP-based file', extension: '.zip', test: bytes => startsWith(bytes, 'PK\x03\x04') || startsWith(bytes, 'PK\x05\x06') },
  gzip: { label: 'a gzip file', extension: '.gz', test: bytes => bytes[0] === 0x1f && bytes[1] === 0x8b },
  html: { label: 'an HTML page', extension: '.html', test: looksLikeHtml },
  text: { label: 'a text file', extension: '.txt', test: looksLikeText },
}

/** Extensions whose expected content is known. Anything else (.php, .aspx, .do…) proves nothing. */
const EXTENSION_KINDS = {
  '.pdf': 'pdf',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
  // Office Open XML, OpenDocument, and EPUB files are ZIP containers.
  '.zip': 'zip',
  '.docx': 'zip',
  '.xlsx': 'zip',
  '.pptx': 'zip',
  '.odt': 'zip',
  '.ods': 'zip',
  '.odp': 'zip',
  '.epub': 'zip',
  '.gz': 'gzip',
  '.tgz': 'gzip',
  '.html': 'html',
  '.htm': 'html',
  '.csv': 'text',
  '.tsv': 'text',
  '.json': 'text',
  '.txt': 'text',
  '.md': 'text',
}

/** Declared Content-Type values that state a specific expectation when the name has no known extension. */
const MIME_KINDS = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'application/gzip': 'gzip',
  'application/x-gzip': 'gzip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
  'text/csv': 'text',
  'application/json': 'text',
  'text/plain': 'text',
}

/** Order in which content is identified: binary signatures first, then HTML, then plain text. */
const DETECTION_ORDER = ['pdf', 'png', 'jpeg', 'gif', 'webp', 'zip', 'gzip', 'html', 'text']

// Tags that open an HTML document, from the WHATWG MIME Sniffing standard
// (https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type).
const HTML_OPENINGS = ['<!doctype html', '<html', '<head', '<script', '<iframe', '<h1', '<div', '<font',
  '<table', '<a', '<style', '<title', '<b', '<body', '<br', '<p', '<!--']

const TITLE_MAX_CHARS = 80

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature.charCodeAt(index)) return false
  }
  return true
}

/** Leading text with an optional UTF-8 BOM and whitespace removed, lowercased, for tag matching. */
function leadingText(bytes, length = 512) {
  return Buffer.from(bytes.subarray(0, length)).toString('latin1')
    .replace(/^\xef\xbb\xbf/u, '')
    .trimStart()
    .toLowerCase()
}

function looksLikeHtml(bytes) {
  const head = leadingText(bytes)
  // A tag must end with a space or '>' so "<b" does not match "<bogus" text.
  return HTML_OPENINGS.some(tag => head.startsWith(tag)
    && (tag === '<!--' || /^[\s>]/u.test(head.slice(tag.length))))
}

/** No NUL bytes and almost no other control characters in the first 4 KB. */
function looksLikeText(bytes) {
  const sample = bytes.subarray(0, 4096)
  let controls = 0
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls++
  }
  return controls <= sample.length / 100
}

/** Identify the content kind from the first bytes, or undefined for unrecognised binary. */
export function detectKind(bytes) {
  return DETECTION_ORDER.find(kind => KINDS[kind].test(bytes))
}

/** The kind a name's extension promises, or undefined for extensions that prove nothing. */
export function expectedKindForName(name) {
  return EXTENSION_KINDS[extname(name).toLowerCase()]
}

/** The kind a declared Content-Type promises, or undefined for vague or unknown types. */
export function expectedKindForMime(contentType) {
  return MIME_KINDS[String(contentType ?? '').split(';')[0].trim().toLowerCase()]
}

/** A short, single-line page title from HTML bytes, for error messages. */
function htmlTitle(bytes) {
  const match = /<title[^>]*>([^<]*)</iu.exec(Buffer.from(bytes.subarray(0, 64 * 1024)).toString('utf8'))
  if (match === null) return undefined
  const title = match[1]
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gu, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name])
    .replace(/\s+/gu, ' ')
    .trim()
  if (title === '') return undefined
  return title.length > TITLE_MAX_CHARS ? title.slice(0, TITLE_MAX_CHARS - 1) + '…' : title
}

function describe(kind, bytes) {
  if (bytes.length === 0) return 'an empty file'
  if (kind === undefined) return 'unrecognised binary content'
  if (kind !== 'html') return KINDS[kind].label
  const title = htmlTitle(bytes)
  return title === undefined ? 'an HTML page' : 'an HTML page titled ' + JSON.stringify(title)
}

/**
 * Whether content of kind `actual` meets the expectation `expected`. A text
 * expectation (CSV, JSON…) is not met by a web page; an HTML expectation
 * accepts any text, since some pages open with a declaration rather than a tag.
 */
function satisfies(expected, actual) {
  return expected === actual || (expected === 'html' && actual === 'text')
}

/**
 * Check downloaded bytes against what the file name (or, failing that, the
 * declared Content-Type) promises. Returns the file name to use, which gains
 * an extension matching the content when the name has none.
 * @param {object} input
 * @param {string} input.fileName - chosen file name.
 * @param {string | undefined} input.contentType - Content-Type the server declared.
 * @param {Uint8Array} input.data - downloaded bytes.
 * @returns {{ fileName: string, kind: string | undefined }} the name to save under and the detected kind.
 * @throws when the content does not match the expectation.
 */
export function verifyContent({ fileName, contentType, data }) {
  const actual = data.length === 0 ? undefined : detectKind(data)
  const nameKind = expectedKindForName(fileName)
  const expected = nameKind ?? expectedKindForMime(contentType)
  if (expected !== undefined && !satisfies(expected, actual)) {
    const source = nameKind !== undefined
      ? 'for ' + fileName
      : 'from the declared Content-Type ' + String(contentType).split(';')[0].trim()
    const hint = actual === 'html'
      ? ' The link may have expired or need a sign-in: read it again from the page that lists it.'
      : ''
    throw new Error('Expected ' + KINDS[expected].label + ' ' + source + ', but received ' + describe(actual, data) + '. Nothing was saved.' + hint)
  }
  if (extname(fileName) === '' && actual !== undefined) {
    return { fileName: fileName + KINDS[actual].extension, kind: actual }
  }
  return { fileName, kind: actual }
}
