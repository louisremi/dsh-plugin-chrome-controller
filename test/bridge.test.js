import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { BrowserExtensionBridge } from '../lib/bridge.js'

const EXTENSION_ORIGIN = 'chrome-extension://' + 'a'.repeat(32)
const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'
const TRUSTED_HOST = 'dsh.example.ts.net'

/** Minimal plugin context: captures routes and models DSH's /api Host fence. */
function fakeContext({ bindHost = '127.0.0.1', rejection } = {}) {
  const routes = new Map()
  const fetchRoutes = new Map()
  const records = new Map()
  const context = {
    routes,
    fetchRoutes,
    webServer: {
      host: bindHost,
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    connection: {
      fetch: {
        register(route) {
          fetchRoutes.set(route.path, route.fetch)
          return () => fetchRoutes.delete(route.path)
        },
      },
      requestRejection: rejection ?? (request => {
        const host = request.headers.host
        if (host === TRUSTED_HOST || host === 'localhost:3080' || host === '127.0.0.1:3080') return 401
        return 403
      }),
    },
    credentials: {
      async readRecord(key) { return records.get(key) },
      async modifyRecord(key, update) {
        const next = await update(records.get(key))
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      },
    },
    on: () => () => {},
    effect: () => {},
  }
  return context
}

/** Drive one extension route with a fake node:http exchange. */
async function call(context, path, { method = 'POST', host = TRUSTED_HOST, origin = EXTENSION_ORIGIN, remoteAddress = '100.64.0.7', body } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  request.headers = { host, ...(origin === null ? {} : { origin }) }
  request.socket = { remoteAddress }
  let status
  let headers = {}
  let text = ''
  const listeners = new Map()
  const response = {
    destroyed: false,
    writeHead(code, values) { status = code; headers = values ?? {} },
    end(chunk) { if (chunk !== undefined) text += String(chunk) },
    once(event, listener) { listeners.set(event, listener) },
    removeListener(event) { listeners.delete(event) },
  }
  const handler = context.routes.get('/dsh-browser-extension/' + path)
  assert.ok(handler, 'route ' + path + ' is registered')
  await handler(request, response)
  return { status, headers, json: text === '' ? undefined : JSON.parse(text) }
}

async function pairingCode(context) {
  return (await context.credentials.readRecord(PAIRING_KEY)).key
}

async function connect(context, options = {}) {
  const code = await pairingCode(context)
  const authorized = await call(context, 'authorize', { ...options, body: { pairingCode: code } })
  assert.equal(authorized.status, 200)
  const connected = await call(context, 'connect', { ...options, body: { pairToken: authorized.json.pairToken } })
  assert.equal(connected.status, 200)
  return connected.json.sessionToken
}

describe('BrowserExtensionBridge authority admission', () => {
  let bridge
  afterEach(async () => { await bridge?.close(); bridge = undefined })

  it('keeps loopback pairing working', async () => {
    const context = fakeContext({ rejection: () => 403 })
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    const loopback = { host: '127.0.0.1:3080', remoteAddress: '127.0.0.1' }
    const preflight = await call(context, 'authorize', { ...loopback, method: 'OPTIONS' })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], EXTENSION_ORIGIN)
    await connect(context, loopback)
  })

  it('accepts a Host that DSH Web trusts from a remote peer and completes a command round trip', async () => {
    const context = fakeContext()
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 5000 })
    assert.equal((await call(context, 'authorize', { method: 'OPTIONS' })).status, 204)
    const sessionToken = await connect(context)
    const result = bridge.request('tabs.list', { a: 1 })
    const polled = await call(context, 'poll', { body: { sessionToken } })
    assert.equal(polled.status, 200)
    assert.equal(polled.json.commands.length, 1)
    const [command] = polled.json.commands
    assert.equal(command.method, 'tabs.list')
    const responded = await call(context, 'respond', { body: { sessionToken, id: command.id, ok: true, result: { tabs: [] } } })
    assert.equal(responded.status, 200)
    assert.deepEqual(await result, { tabs: [] })
  })

  it('rejects a Host that DSH Web does not trust', async () => {
    const context = fakeContext()
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    assert.equal((await call(context, 'authorize', { method: 'OPTIONS', host: 'evil.example' })).status, 403)
    const code = await pairingCode(context)
    const denied = await call(context, 'authorize', { host: 'evil.example', body: { pairingCode: code } })
    assert.equal(denied.status, 403)
    assert.equal(denied.headers['access-control-allow-origin'], undefined)
  })

  it('rejects a trusted Host when the Origin is not a Chrome extension', async () => {
    const context = fakeContext()
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    const code = await pairingCode(context)
    for (const origin of ['https://evil.example', null]) {
      const denied = await call(context, 'authorize', { origin, body: { pairingCode: code } })
      assert.equal(denied.status, 403)
    }
  })

  it('still rejects a loopback Host from a remote peer when DSH Web does not trust it', async () => {
    const context = fakeContext({ rejection: () => 403 })
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    const denied = await call(context, 'authorize', { method: 'OPTIONS', host: '127.0.0.1:3080', remoteAddress: '172.19.0.9' })
    assert.equal(denied.status, 403)
  })

  it('fails closed when the Host fence throws', async () => {
    const context = fakeContext({ rejection: () => { throw new Error('boom') } })
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    assert.equal((await call(context, 'authorize', { method: 'OPTIONS' })).status, 403)
  })

  it('starts when DSH Web binds an address other than 127.0.0.1', async () => {
    const context = fakeContext({ bindHost: '172.19.0.4' })
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    assert.ok(context.routes.has('/dsh-browser-extension/connect'))
  })
})

describe('BrowserExtensionBridge pairing failure limit', () => {
  let bridge
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: 1_000_000 }))
  afterEach(async () => {
    await bridge?.close()
    bridge = undefined
    mock.timers.reset()
  })

  it('refuses every attempt after 10 wrong codes in a minute, then recovers', async () => {
    const context = fakeContext()
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    const wrong = { body: { pairingCode: 'x'.repeat(24) } }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await call(context, 'authorize', wrong)).status, 401)
    }
    assert.equal((await call(context, 'authorize', wrong)).status, 429)
    const code = await pairingCode(context)
    assert.equal((await call(context, 'authorize', { body: { pairingCode: code } })).status, 429)
    mock.timers.tick(60_001)
    assert.equal((await call(context, 'authorize', { body: { pairingCode: code } })).status, 200)
  })

  it('resets the failure count after a successful pairing', async () => {
    const context = fakeContext()
    bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    const wrong = { body: { pairingCode: 'x'.repeat(24) } }
    for (let attempt = 0; attempt < 9; attempt += 1) await call(context, 'authorize', wrong)
    const code = await pairingCode(context)
    assert.equal((await call(context, 'authorize', { body: { pairingCode: code } })).status, 200)
    for (let attempt = 0; attempt < 9; attempt += 1) {
      assert.equal((await call(context, 'authorize', wrong)).status, 401)
    }
  })
})

describe('pairing settings page', () => {
  it('shows the escaped origin the user browsed to', async () => {
    const context = fakeContext()
    const bridge = await BrowserExtensionBridge.create(context, { operationTimeoutMs: 1000 })
    try {
      const page = await context.fetchRoutes.get('/api/dsh-browser-extension/pairing')(new Request('http://x/api/dsh-browser-extension/pairing', {
        headers: { host: 'dsh.example.ts.net"><b', 'x-forwarded-proto': 'https' },
      }))
      const html = await page.text()
      assert.match(html, /value="https:\/\/dsh\.example\.ts\.net&#34;&#62;&#60;b"/u)
    } finally {
      await bridge.close()
    }
  })
})
