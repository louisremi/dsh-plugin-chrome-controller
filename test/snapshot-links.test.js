import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { apply } from '../lib/index.js'

// The service worker registers Chrome listeners at load, so it cannot be
// imported here. frameSnapshotPayload is injected into frames as a
// self-contained function, so its source can be evaluated with a fake DOM.
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
const match = /function frameSnapshotPayload\([\s\S]*?\n\}\n/u.exec(source)
assert.ok(match, 'frameSnapshotPayload is present in background.js')

function fakeFrame({ anchors = [], href = 'https://shop.test/account' } = {}) {
  const document = {
    title: 'Billing',
    body: { innerText: 'visible text' },
    querySelectorAll(selector) { return selector === 'a[href]' ? anchors : [] },
    querySelector() { return null },
  }
  return { document, location: { href }, window: {} }
}

function loadFrameSnapshotPayload(frame = fakeFrame()) {
  return new Function('document', 'location', 'window',
    match[0] + '\nreturn frameSnapshotPayload')(frame.document, frame.location, frame.window)
}

function link(text, url) {
  return { innerText: text, href: url, getAttribute: () => null }
}

const LONG_TEXT = 'x'.repeat(200)

describe('frameSnapshotPayload behavior', () => {
  const run = (anchors, maxChars, maxLinks, includeLinks) => {
    return loadFrameSnapshotPayload(fakeFrame({ anchors }))(maxChars, maxLinks, includeLinks)
  }

  it('caps links at maxLinks, trims text, and reports totalLinks and linksTruncated', () => {
    const anchors = Array.from({ length: 5 }, (_, index) => link(LONG_TEXT, 'https://shop.test/a/' + String(index)))
    const payload = run(anchors, 1_000, 2, true)
    assert.equal(payload.links.length, 2)
    assert.equal(payload.links[0].text.length, 120)
    assert.equal(payload.totalLinks, 5)
    assert.equal(payload.linksTruncated, true)
  })

  it('masks access tokens and Bearer values in link URLs and text', () => {
    const anchors = [
      link('Authorization: Bearer tok_123', 'https://shop.test/inv?access_token=secret&x=1'),
    ]
    const payload = run(anchors, 1_000, 100, true)
    assert.equal(payload.links[0].url, 'https://shop.test/inv?access_token=<redacted>&x=1')
    assert.equal(payload.links[0].text, 'Authorization: Bearer <redacted>')
    assert.equal(payload.url, 'https://shop.test/account')
  })

  it('masks the same sensitive query keys as dsh_browser_evaluate', () => {
    const anchors = [
      link('statement', 'https://shop.test/file?token=abc&key=k1&secret=s1&password=p1&session=sid&signature=sig&expires=1&page=2'),
    ]
    const payload = run(anchors, 1_000, 100, true)
    assert.equal(
      payload.links[0].url,
      'https://shop.test/file?token=<redacted>&key=<redacted>&secret=<redacted>&password=<redacted>&session=<redacted>&signature=<redacted>&expires=<redacted>&page=2',
    )
  })

  it('masks sensitive query keys in the main-frame snapshot expression too', () => {
    assert.match(source, /\(\[\?&\]\(\?:token\|key\|secret\|password/u)
  })

  it('returns an empty links array with the total still reported when includeLinks is false', () => {
    const anchors = [link('one', 'https://shop.test/1'), link('two', 'https://shop.test/2')]
    const payload = run(anchors, 1_000, 100, false)
    assert.deepEqual(payload.links, [])
    assert.equal(payload.totalLinks, 2)
    assert.equal(payload.linksTruncated, true)
    assert.equal(payload.text, 'visible text')
  })

  it('defaults to 100 links without truncation for a small page', () => {
    const anchors = Array.from({ length: 3 }, (_, index) => link('link ' + String(index), 'https://shop.test/' + String(index)))
    const payload = run(anchors, 1_000, undefined, undefined)
    assert.equal(payload.links.length, 3)
    assert.equal(payload.totalLinks, 3)
    assert.equal(payload.linksTruncated, false)
  })
})

const EXTENSION_ORIGIN = 'chrome-extension://' + 'd'.repeat(32)
const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'

/** A plugin context complete enough to pair and call the snapshot tool. */
function fakePluginContext() {
  const routes = new Map()
  const tools = new Map()
  const records = new Map()
  const disposers = []
  return {
    routes,
    registered: tools,
    disposers,
    skills: { register() {} },
    systemPrompt: { section() {}, getSectionOrder: () => 0 },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    webServer: { host: '127.0.0.1', register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    connection: { fetch: { register: () => () => {} }, requestRejection: () => 401 },
    credentials: {
      async readRecord(key) { return records.get(key) },
      async modifyRecord(key, update) {
        const next = await update(records.get(key))
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      },
    },
    on: () => () => {},
    effect(factory) { disposers.push(factory()) },
    get: () => undefined,
  }
}

async function call(context, path, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))])
  request.method = 'POST'
  request.headers = { host: '127.0.0.1:3080', origin: EXTENSION_ORIGIN }
  request.socket = { remoteAddress: '127.0.0.1' }
  let text = ''
  const response = {
    destroyed: false,
    writeHead() {},
    end(chunk) { if (chunk !== undefined) text += String(chunk) },
    once() {},
    removeListener() {},
  }
  await context.routes.get('/dsh-browser-extension/' + path)(request, response)
  return text === '' ? undefined : JSON.parse(text)
}

/** Pair a fake extension, then answer the next command with `reply`. */
async function pairAndAnswer(context, reply) {
  const pairingCode = (await context.credentials.readRecord(PAIRING_KEY)).key
  const { pairToken } = await call(context, 'authorize', { pairingCode })
  const { sessionToken } = await call(context, 'connect', { pairToken })
  return async () => {
    let commands = []
    while (commands.length === 0) ({ commands } = await call(context, 'poll', { sessionToken }))
    const [command] = commands
    await call(context, 'respond', { sessionToken, id: command.id, ok: true, result: reply(command) })
    return command
  }
}

const SNAPSHOT_REPLY = { title: 'Billing', url: 'https://shop.test/', text: 'hi', links: [], totalLinks: 0, linksTruncated: false }

describe('dsh_browser_snapshot link bounds', () => {
  let context
  const exec = () => ({ name: 'dsh_browser_snapshot', callId: 'call-1', agent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal })

  beforeEach(async () => {
    context = fakePluginContext()
    await apply(context)
  })

  afterEach(async () => {
    for (const dispose of context?.disposers ?? []) await dispose?.()
  })

  it('passes the default maxLinks and includeLinks to the extension', async () => {
    const answer = await pairAndAnswer(context, () => SNAPSHOT_REPLY)
    const pending = context.registered.get('dsh_browser_snapshot').execute({ tabId: 7 }, exec())
    const command = await answer()
    assert.equal(command.method, 'page.snapshot')
    assert.deepEqual(command.params, { tabId: 7, maxLinks: 100, includeLinks: true })
    assert.deepEqual(await pending, SNAPSHOT_REPLY)
  })

  it('passes explicit maxLinks and includeLinks through', async () => {
    const answer = await pairAndAnswer(context, () => SNAPSHOT_REPLY)
    const pending = context.registered.get('dsh_browser_snapshot').execute({ tabId: 7, maxLinks: 5, includeLinks: false }, exec())
    const command = await answer()
    assert.deepEqual(command.params, { tabId: 7, maxLinks: 5, includeLinks: false })
    await pending
  })

  it('rejects out-of-range maxLinks before contacting the extension', async () => {
    const tool = context.registered.get('dsh_browser_snapshot')
    await assert.rejects(tool.execute({ tabId: 7, maxLinks: 0 }, exec()), /maxLinks must be an integer between 1 and 100/u)
    await assert.rejects(tool.execute({ tabId: 7, maxLinks: 101 }, exec()), /maxLinks must be an integer between 1 and 100/u)
  })

  it('rejects a non-boolean includeLinks', async () => {
    const tool = context.registered.get('dsh_browser_snapshot')
    await assert.rejects(tool.execute({ tabId: 7, includeLinks: 'yes' }, exec()), /Invalid browser argument: includeLinks/u)
  })
})
