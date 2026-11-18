import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, it } from 'node:test'

// The service worker registers Chrome listeners at load, so it cannot be
// imported here. fetchFileAsBase64 is self-contained (it is injected into tab
// frames by chrome.scripting), so its source can be evaluated on its own.
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
const match = /async function fetchFileAsBase64\([\s\S]*?\n\}\n/u.exec(source)
assert.ok(match, 'fetchFileAsBase64 is present in background.js')
const fetchFileAsBase64 = new Function('return ' + match[0])()

const realFetch = globalThis.fetch

/** Stub fetch: `cors` answers normal requests, `noCors` answers mode:'no-cors' probes. */
function stubFetch({ cors, noCors }) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(init.mode ?? 'cors')
    const handler = init.mode === 'no-cors' ? noCors : cors
    return handler(url)
  }
  return calls
}

describe('extension fetchFileAsBase64', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  it('returns base64 bytes and headers from a readable response', async () => {
    stubFetch({ cors: () => new Response('%PDF', { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="a.pdf"' } }) })
    const result = await fetchFileAsBase64('https://shop.test/a.pdf', 1024, 'page')
    assert.equal(result.via, 'page')
    assert.equal(Buffer.from(result.base64, 'base64').toString(), '%PDF')
    assert.equal(result.contentType, 'application/pdf')
    assert.equal(result.contentDisposition, 'attachment; filename="a.pdf"')
  })

  it('asks for a service-worker retry only when the server answered but CORS blocked the read', async () => {
    const calls = stubFetch({
      cors: () => { throw new TypeError('Failed to fetch') },
      noCors: () => new Response(null, { status: 200 }),
    })
    assert.deepEqual(await fetchFileAsBase64('https://s3.test/a.pdf', 1024, 'page'), { blockedByCors: true })
    assert.deepEqual(calls, ['cors', 'no-cors'])
  })

  it('reports a network failure from the page without asking for a retry', async () => {
    stubFetch({
      cors: () => { throw new TypeError('Failed to fetch') },
      noCors: () => { throw new TypeError('Failed to fetch') },
    })
    const result = await fetchFileAsBase64('https://down.test/a.pdf', 1024, 'page')
    assert.equal(result.blockedByCors, undefined)
    assert.match(result.error, /^The page could not fetch the URL/u)
  })

  it('names the extension, not the page, when the service-worker retry fails', async () => {
    stubFetch({ cors: () => { throw new TypeError('Failed to fetch') } })
    const result = await fetchFileAsBase64('https://s3.test/a.pdf', 1024, 'extension')
    assert.match(result.error, /^The extension could not fetch the URL/u)
    stubFetch({ cors: () => new Response('no', { status: 403 }) })
    assert.match((await fetchFileAsBase64('https://s3.test/a.pdf', 1024, 'extension')).error, /^The extension request failed with HTTP status 403/u)
  })

  it('refuses files over the byte limit', async () => {
    stubFetch({ cors: () => new Response('x'.repeat(20)) })
    assert.match((await fetchFileAsBase64('https://shop.test/a.pdf', 10, 'page')).error, /larger than the 10-byte limit/u)
  })
})
