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

/**
 * The retry path: fetchFileWithTabSession, fetchFileApprovedRetry, and their
 * token helpers, evaluated with stubbed Chrome APIs and the real fetchFileAsBase64.
 */
function extractFunction(name) {
  const found = new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'u').exec(source)
  assert.ok(found, name + ' is present in background.js')
  return found[0]
}
function loadRetryFlow({ pagePayload, redirects = [] }) {
  const listeners = new Set()
  const chrome = {
    webRequest: {
      onBeforeRedirect: {
        addListener(listener) { listeners.add(listener) },
        removeListener(listener) { listeners.delete(listener) },
      },
    },
  }
  const self = { location: { origin: 'chrome-extension://ext' } }
  const helpers = {
    requireTabId: value => value,
    requireFrameId: value => value,
    isRecord: value => value !== null && typeof value === 'object',
    httpUrl: value => { const url = new URL(value); if (!/^https?:$/u.test(url.protocol)) throw new Error('Only HTTP and HTTPS pages can be opened'); return value },
    runInFrame: async () => pagePayload,
    emitRedirects: () => { for (const details of redirects) for (const listener of listeners) listener(details) },
  }
  const body = [
    'const MAX_FETCH_FILE_BYTES = 1024',
    'const FETCH_RETRY_TOKEN_TTL_MS = 60000',
    'const MAX_FETCH_RETRY_TOKENS = 20',
    'const fetchRetryTokens = new Map()',
    ...['fetchFileWithTabSession', 'fetchFileApprovedRetry', 'downloadUrl', 'issueFetchRetryToken', 'consumeFetchRetryToken', 'fetchFileAsBase64'].map(extractFunction),
    'return { fetchFileWithTabSession, fetchFileApprovedRetry, listeners: () => 0 }',
  ].join('\n')
  const api = new Function('chrome', 'self', 'requireTabId', 'requireFrameId', 'isRecord', 'httpUrl', 'runInFrame', body)(
    chrome, self, helpers.requireTabId, helpers.requireFrameId, helpers.isRecord, helpers.httpUrl, helpers.runInFrame)
  return { ...api, emitRedirects: helpers.emitRedirects, listenerCount: () => listeners.size }
}

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

  it('fetches with redirect manual only when asked to, and reports a redirect without following it', async () => {
    const inits = []
    globalThis.fetch = async (_url, init) => { inits.push(init.redirect); return { type: 'opaqueredirect', ok: false, status: 0 } }
    assert.deepEqual(await fetchFileAsBase64('https://s3.test/a', 1024, 'extension', 'manual'), { redirected: true })
    assert.deepEqual(inits, ['manual'])
  })
})

describe('extension approved retry', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  it('does not retry by itself: a CORS-blocked page fetch returns a one-time token for this tab and URL', async () => {
    let fetched = 0
    globalThis.fetch = async () => { fetched++; return new Response('x') }
    const flow = loadRetryFlow({ pagePayload: { blockedByCors: true } })
    const result = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://s3.test/a.pdf' })
    assert.equal(result.needsApproval, 'cors-retry')
    assert.equal(result.url, 'https://s3.test/a.pdf')
    assert.match(result.retryToken, /^[0-9a-f-]{36}$/u)
    assert.equal(fetched, 0)
  })

  it('accepts a token once, only for its tab and URL', async () => {
    globalThis.fetch = async () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
    const flow = loadRetryFlow({ pagePayload: { blockedByCors: true } })
    const { retryToken } = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://s3.test/a.pdf' })
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://evil.test/a.pdf', retryToken }), /not offered/u)
    // The mismatched attempt consumed it.
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://s3.test/a.pdf', retryToken }), /not offered/u)
    const fresh = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://s3.test/a.pdf' })
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 8, url: 'https://s3.test/a.pdf', retryToken: fresh.retryToken }), /not offered/u)
    const again = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://s3.test/a.pdf' })
    const ok = await flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://s3.test/a.pdf', retryToken: again.retryToken })
    assert.equal(ok.via, 'extension')
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://s3.test/a.pdf', retryToken: again.retryToken }), /not offered/u)
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://s3.test/a.pdf' }), /not offered/u)
  })

  it('stops at a redirect and returns its target with a fresh token bound to the target', async () => {
    const redirects = [{ tabId: -1, initiator: 'chrome-extension://ext', url: 'https://shop.test/dl/1', redirectUrl: 'https://bucket.s3.test/inv.pdf?X-Amz-Signature=abc', statusCode: 302 }]
    const flow = loadRetryFlow({ pagePayload: { blockedByCors: true }, redirects })
    const requested = []
    globalThis.fetch = async (url, init) => {
      requested.push([url, init.redirect])
      if (url === 'https://shop.test/dl/1') { flow.emitRedirects(); return { type: 'opaqueredirect', ok: false, status: 0 } }
      return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
    }
    const first = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://shop.test/dl/1' })
    const hop = await flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://shop.test/dl/1', retryToken: first.retryToken })
    assert.equal(hop.needsApproval, 'redirect')
    assert.equal(hop.location, 'https://bucket.s3.test/inv.pdf?X-Amz-Signature=abc')
    assert.equal(hop.status, 302)
    assert.equal(flow.listenerCount(), 0)
    assert.deepEqual(requested, [['https://shop.test/dl/1', 'manual']])
    const done = await flow.fetchFileApprovedRetry({ tabId: 7, url: hop.location, retryToken: hop.retryToken })
    assert.equal(Buffer.from(done.base64, 'base64').toString(), '%PDF-1.4')
    assert.deepEqual(requested[1], [hop.location, 'manual'])
  })

  it('refuses a redirect to a non-HTTP URL', async () => {
    const flow = loadRetryFlow({ pagePayload: { blockedByCors: true }, redirects: [{ tabId: -1, initiator: 'chrome-extension://ext', url: 'https://shop.test/dl', redirectUrl: 'file:///etc/passwd', statusCode: 302 }] })
    globalThis.fetch = async () => { flow.emitRedirects(); return { type: 'opaqueredirect', ok: false, status: 0 } }
    const first = await flow.fetchFileWithTabSession({ tabId: 7, url: 'https://shop.test/dl' })
    await assert.rejects(flow.fetchFileApprovedRetry({ tabId: 7, url: 'https://shop.test/dl', retryToken: first.retryToken }), /unsupported URL/u)
  })
})
