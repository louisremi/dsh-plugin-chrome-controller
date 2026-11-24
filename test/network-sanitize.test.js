import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { SENSITIVE_QUERY_KEY, elideDataUrl } from '../extension/evaluation-sanitize.js'
import { apply } from '../lib/index.js'
import { call, fakePluginContext, pairAndAnswer } from './helpers/plugin-harness.js'

// The service worker registers Chrome listeners at load, so it cannot be
// imported here. The network helpers are pure, so their source can be
// evaluated on its own (the same approach as extension-fetch-file.test.js).
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
function extractFunction(name) {
  const found = new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'u').exec(source)
  assert.ok(found, name + ' is present in background.js')
  return found[0]
}
function loadNetworkHelpers() {
  const body = [
    ...['isRecord', 'redactNetworkUrl', 'redactNetworkPath', 'redactNetworkHeaders', 'filterNetworkRequests'].map(extractFunction),
    'return { redactNetworkUrl, redactNetworkPath, redactNetworkHeaders, filterNetworkRequests }',
  ].join('\n')
  return new Function('elideDataUrl', 'SENSITIVE_QUERY_KEY_PATTERN', 'SENSITIVE_HEADER_PATTERN', body)(
    elideDataUrl,
    new RegExp('(?:' + SENSITIVE_QUERY_KEY + ')', 'iu'),
    new RegExp('(?:' + SENSITIVE_QUERY_KEY + '|proxy-auth)', 'iu'),
  )
}
const { redactNetworkUrl, redactNetworkPath, redactNetworkHeaders, filterNetworkRequests } = loadNetworkHelpers()

const DATA_PAYLOAD = 'data:application/pdf;base64,' + 'JVBERi0xLjQK'.repeat(400)
const DATA_PLACEHOLDER = 'data:application/pdf;base64,…[' + String(DATA_PAYLOAD.length) + ' chars elided]'

describe('redactNetworkUrl', () => {
  it('replaces a long data: URL with a compact placeholder, with and without sensitive data', () => {
    assert.ok(DATA_PAYLOAD.length > 4_000)
    assert.equal(redactNetworkUrl(DATA_PAYLOAD), DATA_PLACEHOLDER)
    assert.equal(redactNetworkUrl(DATA_PAYLOAD, true), DATA_PLACEHOLDER)
    assert.ok(!redactNetworkUrl(DATA_PAYLOAD, true).includes('JVBERi0xLjQK'))
  })

  it('names the media type of a non-base64 data: URL too', () => {
    const plain = 'data:text/plain,hello'
    assert.equal(redactNetworkUrl(plain), 'data:text/plain,…[' + String(plain.length) + ' chars elided]')
    const bare = 'data:;base64,AAAA'
    assert.equal(redactNetworkUrl(bare), 'data:application/octet-stream;base64,…[' + String(bare.length) + ' chars elided]')
  })

  it('redacts every key in the shared sensitive list, including expires', () => {
    const url = 'https://shop.test/x?expires=1&csrf=2&cookie=3&id=4'
    assert.equal(
      redactNetworkUrl(url),
      'https://shop.test/x?expires=%5BREDACTED%5D&csrf=%5BREDACTED%5D&cookie=%5BREDACTED%5D&id=4',
    )
  })

  it('still redacts sensitive query values by default, and only slices when opted in', () => {
    const url = 'https://shop.test/invoice?token=abc123&id=1'
    const redacted = redactNetworkUrl(url)
    assert.match(redacted, /token=%5BREDACTED%5D/u)
    assert.ok(!redacted.includes('abc123'))
    assert.equal(redactNetworkUrl(url, true), url)
    const longUrl = 'https://shop.test/' + 'a'.repeat(3_000)
    assert.equal(redactNetworkUrl(longUrl, true).length, 2_048)
  })
})

describe('data: URLs through network headers and paths', () => {
  it('elides a data: URL that arrives as an HTTP/2 :path value', () => {
    const headers = redactNetworkHeaders({ ':path': DATA_PAYLOAD, authorization: 'Bearer secret', 'content-type': 'application/pdf' })
    assert.equal(headers[':path'], DATA_PLACEHOLDER)
    assert.equal(headers.authorization, '[REDACTED]')
    const sensitive = redactNetworkHeaders({ ':path': DATA_PAYLOAD, authorization: 'Bearer secret' }, true)
    assert.equal(sensitive[':path'], DATA_PLACEHOLDER)
    assert.equal(sensitive.authorization, 'Bearer secret')
  })

  it('elides a data: URL passed to redactNetworkPath', () => {
    assert.equal(redactNetworkPath(DATA_PAYLOAD), DATA_PLACEHOLDER)
    assert.equal(redactNetworkPath('/invoice?token=abc', 'https://shop.test'), '/invoice?token=%5BREDACTED%5D')
  })
})

/** Captured request records shaped like the extension's result. */
function fixtureRequests() {
  return [
    {
      url: 'https://shop.test/assets/app.js',
      method: 'GET',
      resourceType: 'Script',
      initiatorType: 'parser',
      startedAt: '2026-11-22T10:00:00.000Z',
      requestHeaders: { accept: '*/*' },
      encodedDataLength: 1_200,
      response: {
        url: 'https://shop.test/assets/app.js',
        status: 200,
        statusText: 'OK',
        mimeType: 'text/javascript',
        protocol: 'h2',
        headers: { 'content-type': 'text/javascript' },
        extraHeaders: { 'x-cache': 'HIT' },
      },
    },
    {
      url: 'https://shop.test/api/invoice?id=1',
      method: 'POST',
      resourceType: 'Fetch',
      initiatorType: 'fetch',
      requestHeaders: { authorization: '[REDACTED]' },
      requestBody: '{"id":1}',
      redirects: [{ url: 'https://cdn.test/downloads/invoice.pdf?sig=abc', status: 302 }],
      encodedDataLength: 51_200,
      response: {
        url: 'https://cdn.test/downloads/invoice.pdf?sig=abc',
        status: 200,
        statusText: 'OK',
        mimeType: 'application/pdf',
        protocol: 'h2',
        headers: { 'content-type': 'application/pdf' },
      },
    },
    {
      url: 'https://track.test/collect?v=1',
      method: 'GET',
      resourceType: 'XHR',
      requestHeaders: { cookie: '[REDACTED]' },
      response: {
        url: 'https://track.test/collect?v=1',
        status: 204,
        statusText: 'No Content',
        mimeType: 'text/plain',
        headers: {},
      },
    },
  ]
}

describe('filterNetworkRequests', () => {
  it('passes everything through when no option is given', () => {
    const requests = fixtureRequests()
    assert.deepEqual(filterNetworkRequests(requests), { requests, filteredOut: 0 })
    assert.deepEqual(filterNetworkRequests(requests, {}), { requests, filteredOut: 0 })
    assert.deepEqual(filterNetworkRequests(undefined), { requests: [], filteredOut: 0 })
  })

  it('keeps requests whose request URL contains a urlIncludes substring', () => {
    const result = filterNetworkRequests(fixtureRequests(), { urlIncludes: ['/api/invoice'] })
    assert.equal(result.requests.length, 1)
    assert.equal(result.requests[0].resourceType, 'Fetch')
    assert.equal(result.filteredOut, 2)
  })

  it('matches URL substrings in redirect and response URLs, case-insensitively', () => {
    for (const urlIncludes of [['INVOICE.PDF'], ['cdn.test/downloads'], ['DOWNLOAD']]) {
      const result = filterNetworkRequests(fixtureRequests(), { urlIncludes })
      assert.equal(result.requests.length, 1, String(urlIncludes))
      assert.equal(result.requests[0].resourceType, 'Fetch', String(urlIncludes))
    }
    assert.deepEqual(filterNetworkRequests(fixtureRequests(), { urlIncludes: ['nothing-here'] }), { requests: [], filteredOut: 3 })
  })

  it('keeps only the listed CDP resource types', () => {
    const xhr = filterNetworkRequests(fixtureRequests(), { resourceTypes: ['XHR'] })
    assert.equal(xhr.requests.length, 1)
    assert.equal(xhr.requests[0].url, 'https://track.test/collect?v=1')
    assert.equal(xhr.filteredOut, 2)
    const two = filterNetworkRequests(fixtureRequests(), { resourceTypes: ['Script', 'Fetch'] })
    assert.deepEqual(two.requests.map(record => record.resourceType), ['Script', 'Fetch'])
    assert.equal(two.filteredOut, 1)
  })

  it('combines both filters', () => {
    const match = filterNetworkRequests(fixtureRequests(), { resourceTypes: ['Fetch'], urlIncludes: ['invoice.pdf'] })
    assert.equal(match.requests.length, 1)
    const miss = filterNetworkRequests(fixtureRequests(), { resourceTypes: ['XHR'], urlIncludes: ['invoice'] })
    assert.deepEqual(miss, { requests: [], filteredOut: 3 })
  })

  it('drops request and response headers but keeps the rest, without mutating the input', () => {
    const requests = fixtureRequests()
    const result = filterNetworkRequests(requests, { omitHeaders: true })
    assert.equal(result.requests.length, 3)
    assert.equal(result.filteredOut, 0)
    for (const record of result.requests) {
      assert.equal(record.requestHeaders, undefined)
      if (record.response !== undefined) {
        assert.equal(record.response.headers, undefined)
        assert.equal(record.response.extraHeaders, undefined)
      }
    }
    const invoice = result.requests[1]
    assert.equal(invoice.url, 'https://shop.test/api/invoice?id=1')
    assert.equal(invoice.method, 'POST')
    assert.equal(invoice.resourceType, 'Fetch')
    assert.equal(invoice.response.url, 'https://cdn.test/downloads/invoice.pdf?sig=abc')
    assert.equal(invoice.response.status, 200)
    assert.equal(invoice.response.statusText, 'OK')
    assert.equal(invoice.response.mimeType, 'application/pdf')
    assert.equal(invoice.response.protocol, 'h2')
    assert.equal(invoice.requestBody, '{"id":1}')
    assert.deepEqual(invoice.redirects, [{ url: 'https://cdn.test/downloads/invoice.pdf?sig=abc', status: 302 }])
    // Keep the caller's fixtures untouched.
    assert.deepEqual(requests, fixtureRequests())
  })

  it('applies omitHeaders after filtering and keeps opted-in bodies', () => {
    const result = filterNetworkRequests(fixtureRequests(), { urlIncludes: ['invoice'], omitHeaders: true })
    assert.equal(result.requests.length, 1)
    assert.equal(result.filteredOut, 2)
    assert.equal(result.requests[0].requestHeaders, undefined)
    assert.equal(result.requests[0].response.headers, undefined)
    assert.equal(result.requests[0].requestBody, '{"id":1}')
  })
})


describe('dsh_browser_network parameters', () => {
  const exec = () => ({ signal: new AbortController().signal })

  it('sends the new filters to the extension and defaults omitHeaders to false', async () => {
    const context = fakePluginContext()
    await apply(context)
    try {
      const tool = context.registered.get('dsh_browser_network')
      const answer = await pairAndAnswer(context, () => ({ tabId: 7, requestCount: 0, totalRequestCount: 2, requests: [] }))
      const pending = tool.execute({ tabId: 7, urlIncludes: ['invoice'], resourceTypes: ['Fetch'], omitHeaders: true }, exec())
      const command = await answer()
      assert.equal(command.method, 'page.networkCapture')
      assert.deepEqual(command.params, {
        tabId: 7,
        durationMs: 3_000,
        includeResponseBodies: false,
        maxBodyChars: 5_000,
        includeSensitiveData: false,
        maxRequestBodyChars: 5_000,
        omitHeaders: true,
        urlIncludes: ['invoice'],
        resourceTypes: ['Fetch'],
      })
      const result = await pending
      assert.equal(result.requestCount, 0)
      assert.equal(result.totalRequestCount, 2)
    } finally {
      for (const dispose of context.disposers) await dispose?.()
    }
  })

  it('passes no filters and omitHeaders false when the caller omits them', async () => {
    const context = fakePluginContext()
    await apply(context)
    try {
      const tool = context.registered.get('dsh_browser_network')
      const answer = await pairAndAnswer(context, () => ({ tabId: 7, requestCount: 1, totalRequestCount: 1, requests: [] }))
      const pending = tool.execute({ tabId: 7 }, exec())
      const command = await answer()
      assert.deepEqual(command.params, {
        tabId: 7,
        durationMs: 3_000,
        includeResponseBodies: false,
        maxBodyChars: 5_000,
        includeSensitiveData: false,
        maxRequestBodyChars: 5_000,
        omitHeaders: false,
      })
      await pending
    } finally {
      for (const dispose of context.disposers) await dispose?.()
    }
  })

  it('rejects malformed filters before contacting the extension', async () => {
    const context = fakePluginContext()
    await apply(context)
    try {
      const tool = context.registered.get('dsh_browser_network')
      const cases = [
        [{ tabId: 7, urlIncludes: [] }, /Invalid number of entries for browser argument: urlIncludes/u],
        [{ tabId: 7, urlIncludes: Array.from({ length: 11 }, () => 'x') }, /Invalid number of entries for browser argument: urlIncludes/u],
        [{ tabId: 7, urlIncludes: [''] }, /urlIncludes entry must be a non-empty string/u],
        [{ tabId: 7, urlIncludes: ['x'.repeat(1_001)] }, /urlIncludes entry must be a non-empty string of at most 1000 characters/u],
        [{ tabId: 7, resourceTypes: ['Fetch', ''] }, /resourceTypes entry must be a non-empty string/u],
        [{ tabId: 7, resourceTypes: Array.from({ length: 21 }, () => 'XHR') }, /Invalid number of entries for browser argument: resourceTypes/u],
        [{ tabId: 7, omitHeaders: 'yes' }, /Invalid browser argument: omitHeaders/u],
      ]
      for (const [args, error] of cases) await assert.rejects(tool.execute(args, exec()), error)
    } finally {
      for (const dispose of context.disposers) await dispose?.()
    }
  })
})
