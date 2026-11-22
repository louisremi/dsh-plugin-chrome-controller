import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { matchesAccept, selectDownloadCandidate } from '../extension/download-capture.js'

/** One recorded capture candidate, as the extension's four sources describe it. */
function candidate(overrides = {}) {
  return {
    via: 'response',
    url: 'https://shop.test/invoices/42.pdf',
    contentType: 'application/pdf',
    bytes: 2_048,
    observedAt: 100,
    ...overrides,
  }
}

describe('matchesAccept', () => {
  it('accepts any file by default, but never HTML, JSON, or JavaScript', () => {
    assert.equal(matchesAccept(candidate(), undefined), true)
    assert.equal(matchesAccept(candidate({ contentType: 'application/zip' }), []), true)
    // An unknown type is not rejected: most downloads are octet-stream or untyped.
    assert.equal(matchesAccept(candidate({ contentType: '' }), undefined), true)
    for (const contentType of [
      'text/html',
      'text/html; charset=utf-8',
      'application/xhtml+xml',
      'application/json',
      'application/problem+json',
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
    ]) {
      assert.equal(matchesAccept(candidate({ contentType }), undefined), false, contentType)
    }
  })

  it('matches a MIME type as a prefix, ignoring parameters', () => {
    assert.equal(matchesAccept(candidate({ contentType: 'application/pdf; charset=binary' }), ['application/pdf']), true)
    assert.equal(matchesAccept(candidate({ contentType: 'application/zip' }), ['application/']), true)
    assert.equal(matchesAccept(candidate({ contentType: 'image/png' }), ['application/pdf']), false)
  })

  it('matches an extension at the end of the URL file name, case-insensitively', () => {
    assert.equal(matchesAccept(candidate({ contentType: '', url: 'https://shop.test/a/Invoice.ZIP?token=x' }), ['.zip']), true)
    assert.equal(matchesAccept(candidate({ contentType: '', url: 'https://shop.test/a/invoice.pdf' }), ['.zip']), false)
    // A blob: URL's last path segment is a random UUID, not a file name.
    assert.equal(matchesAccept(candidate({ contentType: 'application/octet-stream', url: 'blob:https://shop.test/3f1c2b7e' }), ['.pdf']), false)
  })

  it('needs a known content type to accept by MIME only', () => {
    assert.equal(matchesAccept(candidate({ contentType: '' }), ['application/pdf']), false)
    assert.equal(matchesAccept(candidate({ contentType: '' }), ['.zip']), false)
  })

  it('rejects anything that is not a candidate object', () => {
    assert.equal(matchesAccept(undefined, undefined), false)
    assert.equal(matchesAccept(null, undefined), false)
  })
})

describe('selectDownloadCandidate', () => {
  it('picks the first acceptable file by observation time, skipping HTML and JSON', () => {
    const html = candidate({ via: 'window-open', contentType: 'text/html', url: 'https://shop.test/login', observedAt: 10 })
    const json = candidate({ via: 'response', contentType: 'application/json', url: 'https://shop.test/api', observedAt: 20 })
    const pdf = candidate({ observedAt: 300 })
    const zip = candidate({ via: 'download', contentType: 'application/zip', url: 'https://shop.test/all.zip', observedAt: 400 })
    const { selected, also } = selectDownloadCandidate([html, json, pdf, zip])
    assert.equal(selected, pdf)
    assert.deepEqual(also, [{ via: 'download', contentType: 'application/zip', bytes: 2_048 }])
  })

  it('keeps the recorded order for candidates observed at the same time', () => {
    const anchor = candidate({ via: 'blob-anchor', url: 'https://shop.test/invoice.pdf', observedAt: 50 })
    const download = candidate({ via: 'download', url: 'https://shop.test/invoice.pdf', observedAt: 50 })
    const { selected, also } = selectDownloadCandidate([anchor, download])
    assert.equal(selected, anchor)
    assert.deepEqual(also, [{ via: 'download', contentType: 'application/pdf', bytes: 2_048 }])
  })

  it('honours the accept list and reports the rest as also without bytes when unknown', () => {
    const pdf = candidate({ observedAt: 10 })
    const zip = candidate({ via: 'download', contentType: 'application/zip', url: 'https://shop.test/all.zip', observedAt: 20 })
    const image = candidate({ via: 'response', contentType: 'image/png', url: 'https://shop.test/logo.png', observedAt: 30 })
    const onlyZip = selectDownloadCandidate([pdf, zip, image], { accept: ['.zip'] })
    assert.equal(onlyZip.selected, zip)
    assert.deepEqual(onlyZip.also, [])
    const everythingButPdf = selectDownloadCandidate([pdf, zip, image], { accept: ['application/zip', 'image/png'] })
    assert.equal(everythingButPdf.selected, zip)
    assert.deepEqual(everythingButPdf.also, [{ via: 'response', contentType: 'image/png', bytes: 2_048 }])
    const windowOpen = selectDownloadCandidate([
      candidate({ via: 'window-open', contentType: '', url: 'https://docs.test/getDoc?id=42', bytes: undefined, observedAt: 5 }),
    ])
    assert.equal(windowOpen.selected?.via, 'window-open')
    assert.deepEqual(windowOpen.also, [])
  })

  it('returns no selected candidate when nothing is acceptable', () => {
    const html = candidate({ contentType: 'text/html', observedAt: 10 })
    assert.deepEqual(selectDownloadCandidate([html]), { selected: undefined, also: [] })
    assert.deepEqual(selectDownloadCandidate(undefined), { selected: undefined, also: [] })
  })
})

// background.js cannot be imported (the service worker registers Chrome
// listeners at load), so its injected spy functions are extracted and run with
// stubbed page globals. This exercises the MAIN-world recording and restore
// without Chrome.
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const found = new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'mu').exec(source)
  assert.ok(found, name + ' is present in background.js')
  return found[0]
}

function loadCaptureSpy() {
  let nextBlob = 0
  const url = { createObjectURL: () => 'blob:https://shop.test/' + String(++nextBlob) }
  class Blob {
    constructor(type = '', size = 0) {
      this.type = type
      this.size = size
    }
  }
  class HTMLAnchorElement {
    click() { this.clicked = true }
  }
  const page = {}
  const body = [
    extractFunction('installCaptureDownloadSpy'),
    extractFunction('readCaptureDownloadSpy'),
    extractFunction('uninstallCaptureDownloadSpy'),
    'return { installCaptureDownloadSpy, readCaptureDownloadSpy, uninstallCaptureDownloadSpy }',
  ].join('\n')
  const api = new Function('URL', 'HTMLAnchorElement', 'Blob', 'globalThis', body)(url, HTMLAnchorElement, Blob, page)
  return { ...api, url, HTMLAnchorElement, Blob, page }
}

function downloadAnchor(HTMLAnchorElement, href, download = 'invoice.pdf') {
  const anchor = new HTMLAnchorElement()
  anchor.href = href
  anchor.download = download
  anchor.hasAttribute = name => name === 'download' && download !== null
  anchor.getAttribute = name => (name === 'download' ? download : null)
  return anchor
}

describe('capture download spy', () => {
  it('records blob URLs the page creates, with type and size', () => {
    const spy = loadCaptureSpy()
    spy.installCaptureDownloadSpy()
    const blobUrl = spy.url.createObjectURL(new spy.Blob('application/pdf', 1_024))
    assert.equal(blobUrl, 'blob:https://shop.test/1')
    assert.deepEqual(spy.readCaptureDownloadSpy().blobs.map(({ url, type, size }) => ({ url, type, size })), [
      { url: 'blob:https://shop.test/1', type: 'application/pdf', size: 1_024 },
    ])
    spy.uninstallCaptureDownloadSpy()
    assert.equal(spy.readCaptureDownloadSpy().active, false)
  })

  it('records download links the page clicks with .click(), and still runs the page click', () => {
    const spy = loadCaptureSpy()
    spy.installCaptureDownloadSpy()
    const anchor = downloadAnchor(spy.HTMLAnchorElement, 'https://shop.test/invoice.pdf')
    anchor.click()
    assert.equal(anchor.clicked, true)
    const plain = new spy.HTMLAnchorElement()
    plain.href = 'https://shop.test/other'
    plain.hasAttribute = () => false
    plain.getAttribute = () => null
    plain.click()
    const state = spy.readCaptureDownloadSpy()
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].href, 'https://shop.test/invoice.pdf')
    spy.uninstallCaptureDownloadSpy()
  })

  it('restores both originals and is safe to install twice', () => {
    const spy = loadCaptureSpy()
    const originalCreate = spy.url.createObjectURL
    const originalClick = spy.HTMLAnchorElement.prototype.click
    spy.installCaptureDownloadSpy()
    spy.installCaptureDownloadSpy()
    spy.url.createObjectURL(new spy.Blob('application/pdf', 10))
    // The second install resets the recorded list instead of nesting wrappers.
    assert.equal(spy.readCaptureDownloadSpy().blobs.length, 1)
    spy.uninstallCaptureDownloadSpy()
    assert.equal(spy.url.createObjectURL, originalCreate)
    assert.equal(spy.HTMLAnchorElement.prototype.click, originalClick)
    assert.equal(spy.page.__dshCaptureDownloadSpy, undefined)
    assert.deepEqual(spy.uninstallCaptureDownloadSpy(), { removed: false })
  })
})

describe('capture download wiring', () => {
  it('registers page.captureDownload and imports the selection module', () => {
    assert.match(source, /from '\.\/download-capture\.js'/u)
    assert.match(source, /case 'page\.captureDownload':/u)
    assert.match(source, /^async function captureDownload\(/mu)
  })

  it('arms the four sources and disarms them in a finally', () => {
    for (const marker of [
      "chrome.downloads.onCreated.addListener(state.onDownloadCreated)",
      'chrome.tabs.onCreated?.addListener(state.onTabCreated)',
      'runInFrame(state.tabId, 0, installCaptureDownloadSpy, [], \'MAIN\')',
      'runInFrame(state.tabId, 0, readCaptureDownloadSpy, [], \'MAIN\')',
      'runInFrame(state.tabId, 0, uninstallCaptureDownloadSpy, [], \'MAIN\')',
      "await debuggerCommand(target, 'Network.enable'",
      "await debuggerCommand(target, 'Page.enable')",
      'await disarmCaptureDownloadSources(state)',
    ]) {
      assert.ok(source.includes(marker), marker)
    }
  })
})

// The capture orchestration cannot run against Chrome here, but its functions
// are plain ESM in the service worker. Extract them and run them with a fake
// chrome namespace, a fake debugger command channel, and stubbed scripting
// calls: this exercises the four sources being armed before the click, the
// first-file selection, and the finally that disarms and cleans up.
const CAPTURE_FUNCTION_NAMES = [
  'installCaptureDownloadSpy', 'readCaptureDownloadSpy', 'uninstallCaptureDownloadSpy',
  'encodeBase64Bytes', 'base64ByteLength', 'requireCaptureAccept',
  'captureCandidateUrl', 'captureSourceOrigin', 'networkResponseContentType',
  'networkResponseDisposition', 'downloadBelongsToTab', 'discardChromeDownload',
  'closeCaptureDownloadTab', 'recordCaptureDownloadCandidate', 'createCaptureDownloadState',
  'loadCaptureDownloadResponseBody', 'armCaptureDownloadSources', 'disarmCaptureDownloadSources',
  'collectCaptureDownloadBlobs', 'collectCaptureDownloadBlob', 'collectCaptureDownloadTabs',
  'collectCaptureDownloadCandidates', 'captureCandidateKey', 'chooseCapturedDownload',
  'capturedDownloadResult', 'captureDownload',
]

const CAPTURE_CONSTANTS = [
  'const DEFAULT_CAPTURE_DOWNLOAD_TIMEOUT_MS = 10000',
  'const MAX_CAPTURE_DOWNLOAD_TIMEOUT_MS = 30000',
  // The harness polls faster than the service worker so tests stay quick.
  'const CAPTURE_DOWNLOAD_POLL_MS = 20',
  'const CAPTURE_DOWNLOAD_SPY_READ_MS = 0',
  'const MAX_CAPTURE_DOWNLOAD_ACCEPT_ENTRIES = 10',
  'const MAX_CAPTURE_DOWNLOAD_ACCEPT_CHARS = 100',
  'const MAX_CAPTURE_DOWNLOAD_CANDIDATES = 50',
  'const MAX_CAPTURE_DOWNLOAD_RESPONSE_BODIES = 10',
  'const MAX_CAPTURE_DOWNLOAD_NETWORK_BYTES = 20 * 1024 * 1024',
  'const MAX_CAPTURE_DOWNLOAD_ALSO = 10',
  'const MAX_FETCH_FILE_BYTES = 10 * 1024 * 1024',
]

function extractCaptureFunction(name) {
  const found = new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'mu').exec(source)
  assert.ok(found, name + ' is present in background.js')
  return found[0]
}

/** Evaluate the capture orchestration with injected Chrome stubs. */
function loadCaptureDownload({ chrome, debuggerCommand, runInFrame, dispatchClick }) {
  const body = [
    ...CAPTURE_CONSTANTS,
    ...CAPTURE_FUNCTION_NAMES.map(extractCaptureFunction),
    'return { captureDownload }',
  ].join('\n')
  return new Function(
    'chrome', 'withDebugger', 'requireTabId', 'requireClickTarget', 'resolveClickPoint',
    'visualCursorMove', 'dispatchClick', 'runInFrame', 'isRecord', 'delay', 'debuggerCommand',
    'matchesAccept', 'selectDownloadCandidate', 'fetchFileAsBase64', body,
  )(
    chrome,
    async (_tabId, operation) => operation({ tabId: 7 }),
    value => value,
    () => 'selector',
    async () => ({ x: 10, y: 20, elementResult: {} }),
    async () => {},
    dispatchClick,
    runInFrame,
    value => typeof value === 'object' && value !== null && !Array.isArray(value),
    ms => new Promise(resolve => setTimeout(resolve, ms)),
    debuggerCommand,
    matchesAccept,
    selectDownloadCandidate,
    // The real injection is never run here: runInFrame recognizes this marker name.
    async function fetchFileAsBase64() { return undefined },
  )
}

/** A fake chrome namespace plus the scripting and CDP stubs the capture calls. */
function createCaptureEnvironment({ click = () => {}, tab = { id: 7, url: 'https://shop.test/page' } } = {}) {
  const listeners = { downloads: new Set(), tabs: new Set(), debugger: new Set() }
  const calls = { cancelled: [], erased: [], removedTabs: [], commands: [], responseBodies: [] }
  const openedTabs = new Map()
  const environment = {
    calls,
    listeners,
    blobs: [],
    blobPayload: () => undefined,
    spyUninstalled: false,
  }
  const chrome = {
    downloads: {
      onCreated: {
        addListener(listener) { listeners.downloads.add(listener) },
        removeListener(listener) { listeners.downloads.delete(listener) },
      },
      async cancel(id) { calls.cancelled.push(id) },
      async erase({ id }) { calls.erased.push(id) },
    },
    tabs: {
      onCreated: {
        addListener(listener) { listeners.tabs.add(listener) },
        removeListener(listener) { listeners.tabs.delete(listener) },
      },
      async get(id) {
        if (id === tab.id) return tab
        if (openedTabs.has(id)) return openedTabs.get(id)
        throw new Error('No tab with id ' + String(id))
      },
      async remove(id) { calls.removedTabs.push(id); openedTabs.delete(id) },
    },
    debugger: {
      onEvent: {
        addListener(listener) { listeners.debugger.add(listener) },
        removeListener(listener) { listeners.debugger.delete(listener) },
      },
    },
  }
  const debuggerCommand = async (_target, method) => {
    calls.commands.push(method)
    if (method === 'Network.getResponseBody') {
      const body = calls.responseBodies.shift()
      if (body === undefined) throw new Error('No response body retained')
      return body
    }
    return {}
  }
  const runInFrame = async (_tabId, _frameId, func, args) => {
    if (func.name === 'installCaptureDownloadSpy') return { installed: true }
    if (func.name === 'readCaptureDownloadSpy') return { active: true, blobs: environment.blobs, anchors: [] }
    if (func.name === 'uninstallCaptureDownloadSpy') {
      environment.spyUninstalled = true
      return { removed: true }
    }
    if (func.name === 'fetchFileAsBase64') return environment.blobPayload(args[0])
    throw new Error('Unexpected injected function ' + func.name)
  }
  environment.download = item => { for (const listener of listeners.downloads) listener(item) }
  environment.tabOpened = (openedTab, laterTab) => {
    if (laterTab !== undefined) openedTabs.set(openedTab.id, laterTab)
    for (const listener of listeners.tabs) listener(openedTab)
  }
  environment.debuggerEvent = (method, params) => {
    for (const listener of listeners.debugger) listener({ tabId: tab.id }, method, params)
  }
  environment.responseBody = body => calls.responseBodies.push(body)
  environment.listenerCounts = () => ({
    downloads: listeners.downloads.size,
    tabs: listeners.tabs.size,
    debugger: listeners.debugger.size,
  })
  environment.api = loadCaptureDownload({
    chrome,
    debuggerCommand,
    runInFrame,
    dispatchClick: async () => { await click(environment) },
  })
  return environment
}

describe('capture download orchestration', () => {
  it('intercepts and erases a Chrome download, then returns its URL', async () => {
    const environment = createCaptureEnvironment({
      click: env => env.download({
        id: 5,
        tabId: 7,
        url: 'https://shop.test/invoices/42.pdf',
        finalUrl: 'https://shop.test/invoices/42.pdf',
        mime: 'application/pdf',
        fileSize: 2_048,
      }),
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 })
    assert.equal(result.captured, true)
    assert.equal(result.source, 'url')
    assert.equal(result.via, 'download')
    assert.equal(result.url, 'https://shop.test/invoices/42.pdf')
    assert.equal(result.sourceOrigin, 'https://shop.test')
    assert.equal(result.navigated, false)
    assert.deepEqual(environment.calls.cancelled, [5])
    assert.deepEqual(environment.calls.erased, [5])
    assert.deepEqual(environment.listenerCounts(), { downloads: 0, tabs: 0, debugger: 0 })
    for (const command of ['Network.enable', 'Page.enable', 'Page.disable', 'Network.disable']) {
      assert.ok(environment.calls.commands.includes(command), command)
    }
  })

  it('matches a download to the tab by referrer when Chrome omits tabId', async () => {
    const environment = createCaptureEnvironment({
      click: env => env.download({
        id: 6,
        referrer: 'https://shop.test/page',
        url: 'https://cdn.test/files/a.pdf',
        mime: 'application/pdf',
      }),
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 })
    assert.equal(result.captured, true)
    assert.equal(result.sourceOrigin, 'https://cdn.test')
    assert.deepEqual(environment.calls.cancelled, [6])
  })

  it('reads a matching response body when the click neither downloads nor opens a tab', async () => {
    const environment = createCaptureEnvironment({
      click: env => {
        env.debuggerEvent('Network.responseReceived', {
          requestId: 'r1',
          type: 'XHR',
          response: {
            url: 'https://shop.test/api/documents/1',
            status: 200,
            mimeType: 'application/pdf',
            headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="facture.pdf"' },
          },
        })
        env.debuggerEvent('Network.loadingFinished', { requestId: 'r1', encodedDataLength: 300 })
      },
    })
    environment.responseBody({ body: Buffer.from('%PDF-1.7 x').toString('base64'), base64Encoded: true })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 })
    assert.equal(result.captured, true)
    assert.equal(result.source, 'bytes')
    assert.equal(result.via, 'response')
    assert.equal(result.contentType, 'application/pdf')
    assert.equal(result.contentDisposition, 'attachment; filename="facture.pdf"')
    assert.equal(result.bytes, Buffer.byteLength('%PDF-1.7 x'))
    assert.equal(Buffer.from(result.base64, 'base64').toString(), '%PDF-1.7 x')
    assert.equal(result.sourceOrigin, 'https://shop.test')
    assert.ok(environment.calls.commands.includes('Network.getResponseBody'))
  })

  it('honours accept: an earlier unrelated image loses to the requested PDF', async () => {
    const environment = createCaptureEnvironment({
      click: env => {
        env.debuggerEvent('Network.responseReceived', {
          requestId: 'image',
          type: 'Image',
          response: { url: 'https://shop.test/spinner.png', status: 200, mimeType: 'image/png', headers: {} },
        })
        env.debuggerEvent('Network.loadingFinished', { requestId: 'image', encodedDataLength: 100 })
        env.debuggerEvent('Network.responseReceived', {
          requestId: 'pdf',
          type: 'XHR',
          response: { url: 'https://shop.test/bill.pdf', status: 200, mimeType: 'application/pdf', headers: {} },
        })
        env.debuggerEvent('Network.loadingFinished', { requestId: 'pdf', encodedDataLength: 200 })
      },
    })
    environment.responseBody({ body: Buffer.from('%PDF-1.4 bill').toString('base64'), base64Encoded: true })
    const result = await environment.api.captureDownload({
      tabId: 7,
      selector: '#download',
      timeoutMs: 300,
      accept: ['application/pdf'],
    })
    assert.equal(result.captured, true)
    assert.equal(result.via, 'response')
    assert.equal(result.contentType, 'application/pdf')
    // The image response was filtered before its body was requested.
    assert.equal(environment.calls.commands.filter(command => command === 'Network.getResponseBody').length, 1)
  })

  it('ignores an HTML response and times out without a file', async () => {
    const environment = createCaptureEnvironment({
      click: env => {
        env.debuggerEvent('Network.responseReceived', {
          requestId: 'page',
          type: 'Document',
          response: { url: 'https://shop.test/signin', status: 200, mimeType: 'text/html', headers: {} },
        })
        env.debuggerEvent('Network.loadingFinished', { requestId: 'page', encodedDataLength: 400 })
      },
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 250 })
    assert.deepEqual(result, { captured: false, reason: 'no file within 250 ms', navigated: false, clicked: true })
    assert.equal(environment.calls.commands.includes('Network.getResponseBody'), false)
  })

  it('reports navigated when the main frame reloads during the capture', async () => {
    const environment = createCaptureEnvironment({
      click: env => env.debuggerEvent('Page.frameNavigated', { frame: { id: '1', url: 'https://shop.test/page' } }),
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 200 })
    assert.deepEqual(result, { captured: false, reason: 'no file within 200 ms', navigated: true, clicked: true })
  })

  it('reads the URL of a tab the click opened and closes it', async () => {
    const environment = createCaptureEnvironment({
      click: env => env.tabOpened(
        { id: 21, openerTabId: 7, pendingUrl: 'about:blank', url: 'about:blank' },
        { id: 21, pendingUrl: 'https://docs.test/getDoc?orderId=42', url: 'https://docs.test/getDoc?orderId=42' },
      ),
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 })
    assert.equal(result.captured, true)
    assert.equal(result.source, 'url')
    assert.equal(result.via, 'window-open')
    assert.equal(result.sourceOrigin, 'https://docs.test')
    // Closed as soon as its URL was read, and again by the finally for safety.
    assert.deepEqual(environment.calls.removedTabs, [21, 21])
    assert.deepEqual(environment.listenerCounts(), { downloads: 0, tabs: 0, debugger: 0 })
  })

  it('reads a page-created blob inside the page and restores the spy', async () => {
    const blobUrl = 'blob:https://shop.test/3f1c2b7e'
    const bytes = Buffer.from('%PDF-1.4 blob')
    const environment = createCaptureEnvironment({
      click: env => {
        env.blobs = [{ url: blobUrl, type: 'application/pdf', size: bytes.length, at: Date.now() }]
        env.blobPayload = () => ({
          via: 'page',
          finalUrl: blobUrl,
          contentType: 'application/pdf',
          contentDisposition: '',
          bytes: bytes.length,
          base64: bytes.toString('base64'),
        })
      },
    })
    const result = await environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 })
    assert.equal(result.captured, true)
    assert.equal(result.source, 'bytes')
    assert.equal(result.via, 'blob-anchor')
    assert.equal(result.contentType, 'application/pdf')
    assert.equal(Buffer.from(result.base64, 'base64').toString(), '%PDF-1.4 blob')
    assert.equal(environment.spyUninstalled, true)
    // The blob URL is internal: the plugin receives it only to name the file.
    assert.equal(result.url, blobUrl)
  })

  it('disarms every source when the click itself fails', async () => {
    const environment = createCaptureEnvironment({
      click: () => { throw new Error('The selected element is covered at its click point') },
    })
    await assert.rejects(
      environment.api.captureDownload({ tabId: 7, selector: '#download', timeoutMs: 300 }),
      /covered at its click point/u)
    assert.deepEqual(environment.listenerCounts(), { downloads: 0, tabs: 0, debugger: 0 })
    assert.equal(environment.spyUninstalled, true)
    assert.ok(environment.calls.commands.includes('Network.disable'))
  })
})
