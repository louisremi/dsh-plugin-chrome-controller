import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { pngDimensions, screenshotScaleNote } from '../lib/screenshot.js'

// A real 1×1 transparent PNG, to prove the reader works on genuine bytes.
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Signature + one IHDR chunk (length, type, 13 data bytes with width/height) + CRC placeholder. */
function pngHeader(width, height, { chunkType = 'IHDR', chunkLength = 13 } = {}) {
  const header = Buffer.alloc(8 + 4 + 4 + 13 + 4)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(chunkLength, 8)
  header.write(chunkType, 12, 'latin1')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header[24] = 8 // bit depth
  header[25] = 6 // RGBA
  return header
}

describe('pngDimensions', () => {
  it('reads the real pixel size from a valid 1×1 PNG', () => {
    assert.deepEqual(pngDimensions(ONE_PIXEL_PNG), {
      width: 1, height: 1, byteLength: Buffer.from(ONE_PIXEL_PNG, 'base64').length, mimeType: 'image/png',
    })
  })

  it('reads the width and height from a base64 PNG header fixture', () => {
    const dimensions = pngDimensions(pngHeader(4260, 2526).toString('base64'))
    assert.equal(dimensions?.width, 4260)
    assert.equal(dimensions?.height, 2526)
  })

  it('accepts decoded bytes as well as base64', () => {
    const bytes = pngHeader(800, 600)
    assert.equal(pngDimensions(bytes)?.width, 800)
    assert.equal(pngDimensions(new Uint8Array(bytes))?.height, 600)
  })

  it('returns undefined for unreadable or invalid data instead of throwing', () => {
    for (const bad of [
      undefined,
      null,
      1234,
      '',
      'not base64 !!!',
      Buffer.from('a JPEG, not a PNG'),
      Buffer.alloc(10),
      pngHeader(800, 600).subarray(0, 20),
    ]) {
      assert.equal(pngDimensions(bad), undefined, String(bad))
    }
  })

  it('rejects a PNG whose first chunk is not IHDR or whose header length is wrong', () => {
    assert.equal(pngDimensions(pngHeader(800, 600, { chunkType: 'IDAT' })), undefined)
    assert.equal(pngDimensions(pngHeader(800, 600, { chunkLength: 12 })), undefined)
  })

  it('rejects zero dimensions', () => {
    assert.equal(pngDimensions(pngHeader(0, 0)), undefined)
  })
})

describe('screenshotScaleNote', () => {
  it('reports the viewport and the factor for a downscaled screenshot', () => {
    assert.equal(
      screenshotScaleNote({ viewport: { width: 2130, height: 1263, devicePixelRatio: 2 }, pngWidth: 4260, pngHeight: 2526 }),
      'Viewport 2130×1263 CSS px; the returned PNG is 4260×2526 px, so multiply image coordinates by 0.5 before clicking.'
        + ' That factor applies to the PNG as returned by this tool; the harness may downscale the image further.',
    )
  })

  it('rounds the factor to a readable number', () => {
    assert.match(screenshotScaleNote({ viewport: { width: 1440, height: 900 }, pngWidth: 3000, pngHeight: 1875 }), /multiply image coordinates by 0\.48 before clicking/u)
    assert.match(screenshotScaleNote({ viewport: { width: 1500, height: 900 }, pngWidth: 1000, pngHeight: 600 }), /multiply image coordinates by 1\.5 before clicking/u)
  })

  it('mentions the PNG width when its height is unknown', () => {
    const note = screenshotScaleNote({ viewport: { width: 1200, height: 800 }, pngWidth: 2400 })
    assert.match(note, /the returned PNG is 2400 px wide, so multiply image coordinates by 0\.5 before clicking/u)
  })

  it('produces no note for missing or nonsensical input', () => {
    for (const input of [
      undefined,
      {},
      { viewport: undefined, pngWidth: 4260 },
      { viewport: { width: 0, height: 1263 }, pngWidth: 4260 },
      { viewport: { width: 2130, height: 1263 }, pngWidth: 0 },
      { viewport: { width: 2130, height: 1263 }, pngWidth: '4260' },
      { viewport: { width: Number.NaN, height: 1263 }, pngWidth: 4260 },
    ]) {
      assert.equal(screenshotScaleNote(input), undefined, JSON.stringify(input))
    }
  })
})

// The service worker registers Chrome listeners at load, so it cannot be
// imported here. readScreenshotViewport is self-contained, so its source can be
// evaluated with stubbed CDP helpers.
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const found = new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'u').exec(source)
  assert.ok(found, name + ' is present in background.js')
  return found[0]
}

function loadViewportReader(debuggerCommand) {
  const constant = /const SCREENSHOT_VIEWPORT_EXPRESSION = [^\n]+\n/u.exec(source)
  assert.ok(constant, 'SCREENSHOT_VIEWPORT_EXPRESSION is present in background.js')
  const body = [constant[0], extractFunction('readScreenshotViewport'), 'return readScreenshotViewport'].join('\n')
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  return new Function('debuggerCommand', 'isRecord', body)(debuggerCommand, isRecord)
}

describe('extension readScreenshotViewport', () => {
  it('reads innerWidth, innerHeight, and devicePixelRatio from the page', async () => {
    const readViewport = loadViewportReader(async (_target, method) => {
      assert.equal(method, 'Runtime.evaluate')
      return { result: { value: { width: 2130, height: 1263, devicePixelRatio: 1.25 } } }
    })
    assert.deepEqual(await readViewport({ tabId: 7 }), { width: 2130, height: 1263, devicePixelRatio: 1.25 })
  })

  it('falls back to Page.getLayoutMetrics when evaluation fails', async () => {
    const readViewport = loadViewportReader(async (_target, method) => {
      if (method === 'Runtime.evaluate') throw new Error('Runtime is unavailable')
      return { cssLayoutViewport: { clientWidth: 1200, clientHeight: 800 } }
    })
    assert.deepEqual(await readViewport({ tabId: 7 }), { width: 1200, height: 800 })
  })

  it('returns undefined rather than failing the screenshot when neither path answers', async () => {
    const readViewport = loadViewportReader(async () => { throw new Error('debugger detached') })
    assert.equal(await readViewport({ tabId: 7 }), undefined)
  })
})
