// Dependency-free screenshot metadata: read the real PNG pixel size from the
// IHDR chunk so the plugin can tell the model how a screenshot's pixels map to
// CSS click coordinates. Parsing is deliberately defensive: a screenshot whose
// size cannot be read is still returned, just without a scale note.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_IHDR = 0x49484452
const IHDR_LENGTH = 13
// Signature (8) + chunk length (4) + chunk type (4) + width (4) + height (4).
const MINIMUM_HEADER_LENGTH = 24

/**
 * Read the pixel dimensions of a PNG from its header. Accepts the base64
 * string returned by the Chrome extension or its decoded bytes.
 * @returns {{ width: number, height: number, byteLength: number, mimeType: string } | undefined}
 */
export function pngDimensions(data) {
  const bytes = toBytes(data)
  if (bytes === undefined || bytes.length < MINIMUM_HEADER_LENGTH) return undefined
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return undefined
  }
  if (readUInt32BE(bytes, 8) !== IHDR_LENGTH || readUInt32BE(bytes, 12) !== PNG_IHDR) return undefined
  const width = readUInt32BE(bytes, 16)
  const height = readUInt32BE(bytes, 20)
  if (width < 1 || height < 1) return undefined
  return { width, height, byteLength: bytes.length, mimeType: 'image/png' }
}

/**
 * Build the one-line note appended to a screenshot. The factor converts
 * coordinates read off the returned PNG into the CSS pixels that click
 * coordinates use: factor = viewport width / PNG width. Returns undefined for
 * a missing or nonsensical viewport or PNG width, so callers omit the note.
 */
export function screenshotScaleNote({ viewport, pngWidth, pngHeight } = {}) {
  const viewportWidth = positiveInteger(viewport?.width)
  const viewportHeight = positiveInteger(viewport?.height)
  const imageWidth = positiveInteger(pngWidth)
  if (viewportWidth === undefined || viewportHeight === undefined || imageWidth === undefined) return undefined
  const factor = viewportWidth / imageWidth
  if (!Number.isFinite(factor) || factor <= 0) return undefined
  const imageHeight = positiveInteger(pngHeight)
  const pngSize = imageHeight === undefined
    ? 'the returned PNG is ' + String(imageWidth) + ' px wide'
    : 'the returned PNG is ' + String(imageWidth) + '×' + String(imageHeight) + ' px'
  return 'Viewport ' + String(viewportWidth) + '×' + String(viewportHeight) + ' CSS px; ' + pngSize
    + ', so multiply image coordinates by ' + formatFactor(factor) + ' before clicking.'
    + ' That factor applies to the PNG as returned by this tool; the harness may downscale the image further.'
}

/** Readable, stable factor text: 0.5, 0.33, 1.25 rather than long floats. */
function formatFactor(factor) {
  const rounded = factor >= 1 ? Math.round(factor * 100) / 100 : Math.round(factor * 1000) / 1000
  return String(rounded)
}

function positiveInteger(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
}

function toBytes(data) {
  if (typeof data === 'string') {
    if (data === '') return undefined
    return Buffer.from(data, 'base64')
  }
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

function readUInt32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}
