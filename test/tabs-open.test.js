import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { apply } from '../lib/index.js'

// The service worker registers Chrome listeners at load, so it cannot be
// imported here. waitForTabLoad is self-contained, so its source can be
// evaluated with a fake chrome.tabs event surface.
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
const match = /function waitForTabLoad\([\s\S]*?\n\}\n/u.exec(source)
assert.ok(match, 'waitForTabLoad is present in background.js')

function loadTabWaiter() {
  return new Function('chrome', match[0] + '\nreturn waitForTabLoad')
}

function fakeChrome({ status = 'loading', getThrows = false } = {}) {
  const updated = new Set()
  const removed = new Set()
  const chrome = {
    tabs: {
      onUpdated: {
        addListener(listener) { updated.add(listener) },
        removeListener(listener) { updated.delete(listener) },
      },
      onRemoved: {
        addListener(listener) { removed.add(listener) },
        removeListener(listener) { removed.delete(listener) },
      },
      async get() {
        if (getThrows) throw new Error('No tab with id: 42')
        return { id: 42, status }
      },
    },
  }
  return {
    chrome,
    emitUpdated(tabId, nextStatus) { for (const listener of [...updated]) listener(tabId, { status: nextStatus }) },
    emitRemoved(tabId) { for (const listener of [...removed]) listener(tabId) },
    counts() { return { updated: updated.size, removed: removed.size } },
  }
}

describe('extension waitForTabLoad', () => {
  it('resolves true when the created tab reports complete, ignoring other tabs and statuses', async () => {
    const fake = fakeChrome()
    const pending = loadTabWaiter()(fake.chrome)(42, 1_000)
    fake.emitUpdated(42, 'loading')
    fake.emitUpdated(7, 'complete')
    fake.emitUpdated(42, 'complete')
    assert.equal(await pending, true)
    assert.deepEqual(fake.counts(), { updated: 0, removed: 0 })
  })

  it('resolves true when the tab is already complete before the wait starts', async () => {
    const fake = fakeChrome({ status: 'complete' })
    assert.equal(await loadTabWaiter()(fake.chrome)(42, 1_000), true)
  })

  it('resolves false when the tab is removed while waiting', async () => {
    const fake = fakeChrome()
    const pending = loadTabWaiter()(fake.chrome)(42, 1_000)
    fake.emitRemoved(42)
    assert.equal(await pending, false)
    assert.deepEqual(fake.counts(), { updated: 0, removed: 0 })
  })

  it('resolves false at the timeout and removes both listeners', async () => {
    const fake = fakeChrome()
    assert.equal(await loadTabWaiter()(fake.chrome)(42, 20), false)
    assert.deepEqual(fake.counts(), { updated: 0, removed: 0 })
  })

  it('resolves false rather than throwing when the tab is already gone', async () => {
    const fake = fakeChrome({ getThrows: true })
    assert.equal(await loadTabWaiter()(fake.chrome)(42, 1_000), false)
  })
})

const EXTENSION_ORIGIN = 'chrome-extension://' + 'c'.repeat(32)
const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'

/** A plugin context complete enough to pair and call the tabs tool. */
function fakePluginContext(root) {
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
    get: name => ({ sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) } })[name],
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

describe('dsh_browser_tabs open', () => {
  let context
  const exec = () => ({ name: 'dsh_browser_tabs', callId: 'call-1', agent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal })

  beforeEach(async () => {
    context = fakePluginContext('/tmp')
    await apply(context)
  })

  afterEach(async () => {
    for (const dispose of context?.disposers ?? []) await dispose?.()
  })

  it('waits for the load by default and passes the default timeout', async () => {
    const answer = await pairAndAnswer(context, () => ({ tabId: 42, url: 'https://shop.test/login', title: 'Sign in', loaded: true }))
    const pending = context.registered.get('dsh_browser_tabs').execute({ action: 'open', url: 'https://shop.test/dashboard' }, exec())
    const command = await answer()
    assert.equal(command.method, 'tabs.open')
    assert.deepEqual(command.params, { url: 'https://shop.test/dashboard', waitForLoad: true, timeoutMs: 15_000 })
    assert.deepEqual(await pending, { tabId: 42, url: 'https://shop.test/login', title: 'Sign in', loaded: true })
  })

  it('passes an explicit timeoutMs and waitForLoad: false through', async () => {
    const answer = await pairAndAnswer(context, () => ({ tabId: 43, url: 'https://shop.test', title: '', loaded: false }))
    const pending = context.registered.get('dsh_browser_tabs').execute({ action: 'open', url: 'https://shop.test', timeoutMs: 5_000, waitForLoad: false }, exec())
    const command = await answer()
    assert.deepEqual(command.params, { url: 'https://shop.test', waitForLoad: false, timeoutMs: 5_000 })
    assert.equal((await pending).loaded, false)
  })

  it('rejects an out-of-range timeout before contacting the extension', async () => {
    const tool = context.registered.get('dsh_browser_tabs')
    await assert.rejects(tool.execute({ action: 'open', url: 'https://shop.test', timeoutMs: 0 }, exec()), /timeoutMs must be an integer between 1 and 25000/u)
    await assert.rejects(tool.execute({ action: 'open', url: 'https://shop.test', timeoutMs: 25_001 }, exec()), /timeoutMs must be an integer between 1 and 25000/u)
  })

  it('rejects waitForLoad and timeoutMs on actions that do not open a tab', async () => {
    const tool = context.registered.get('dsh_browser_tabs')
    await assert.rejects(tool.execute({ action: 'activate', tabId: 7, waitForLoad: true }, exec()), /only apply to tabs action open/u)
  })
})
