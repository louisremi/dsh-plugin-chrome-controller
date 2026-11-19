import { randomBytes, timingSafeEqual } from 'node:crypto'

const PAIR_PATH = '/api/dsh-browser-extension/pair'
const PAIRING_SETTINGS_PATH = '/api/dsh-browser-extension/pairing'
const AUTHORIZE_PATH = '/dsh-browser-extension/authorize'
const CONNECT_PATH = '/dsh-browser-extension/connect'
const POLL_PATH = '/dsh-browser-extension/poll'
const RESPONSE_PATH = '/dsh-browser-extension/respond'
const DISCONNECT_PATH = '/dsh-browser-extension/disconnect'
const EXTENSION_PATHS = new Set([AUTHORIZE_PATH, CONNECT_PATH, POLL_PATH, RESPONSE_PATH, DISCONNECT_PATH])
const PAIR_LIFETIME_MS = 30_000
const SESSION_IDLE_MS = 60_000
const POLL_WAIT_MS = 15_000
const MAX_BODY_BYTES = 20 * 1024 * 1024
const MAX_PAIR_TOKENS = 16
const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/u
// Backlog cap. In-flight commands are handed to poll waiters and leave the queue,
// so the bridge accepts at least MAX_IN_FLIGHT + this many commands before
// rejecting. Queued commands are delivered FIFO unless cancelled or the session ends.
const MAX_QUEUED_COMMANDS = 256
// Commands delivered per poll response. Chrome allows only ~6 concurrent
// connections per host (HTTP/1.1), so the extension keeps just a few long-polls
// open; each poll is answered with a batch of queued commands instead.
const MAX_COMMANDS_PER_POLL = 8
// Wrong pairing codes tolerated per window before every attempt is refused.
// Counted globally: behind a relay or reverse proxy every peer looks local.
const PAIRING_FAILURE_LIMIT = { max: 10, windowMs: 60_000 }
// requestRejection() statuses: 403 is DSH Web's Host fence (refused); 401 means
// the Host passed and only the browser cookie is missing; undefined is no
// rejection. Anything else is treated as a refusal.
const HOST_ACCEPTED_STATUSES = new Set([401, undefined])

/** Count of recent failures; exceeded once `max` happen within `windowMs`. */
class FailureWindow {
  #times = []
  #max
  #windowMs

  constructor({ max, windowMs }) {
    this.#max = max
    this.#windowMs = windowMs
  }

  record() {
    this.#times.push(Date.now())
  }

  reset() {
    this.#times = []
  }

  exceeded() {
    const since = Date.now() - this.#windowMs
    this.#times = this.#times.filter(at => at > since)
    return this.#times.length >= this.#max
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExtensionOrigin(value) {
  if (typeof value !== 'string') return false
  try {
    const origin = new URL(value)
    return origin.protocol === 'chrome-extension:' && /^[a-p]{32}$/u.test(origin.hostname)
      && value === 'chrome-extension://' + origin.hostname
  } catch {
    return false
  }
}

function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress?.toLowerCase()
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('127.')
    || address?.startsWith('::ffff:127.') === true
}

function isLoopbackHost(value) {
  return typeof value === 'string'
    && /^(?:(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?|\[::1\](?::[0-9]{1,5})?)$/iu.test(value)
}

/**
 * Whether a request may reach the extension routes: a loopback Host on a
 * loopback socket, or a Host that DSH Web's own /api Host fence accepts
 * (the bind address or a configured trustedHosts authority). Only the Host
 * header is offered to the fence: the extension's Origin is not the page's.
 */
function isAdmittedAuthority(request, connection) {
  if (isLoopbackRequest(request) && isLoopbackHost(request.headers?.host)) return true
  const host = request.headers?.host
  if (typeof host !== 'string' || host === '' || connection === undefined) return false
  try {
    return HOST_ACCEPTED_STATUSES.has(connection.requestRejection({ headers: { host } }))
  } catch {
    return false
  }
}

/** Encode a value for a double-quoted HTML attribute or text node. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, character => `&#${character.charCodeAt(0)};`)
}

/** Best-effort origin the user browsed to, for display only; nothing trusts it. */
function displayedOrigin(request) {
  const host = request.headers.get('host') ?? ''
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : 'http'
  return host === '' ? '' : protocol + '://' + host
}

function pairingCodeFrom(record) {
  return record?.kind === 'api-key' && typeof record.key === 'string'
    && PAIRING_CODE_PATTERN.test(record.key) ? record.key : undefined
}

function writeJson(response, status, value, origin) {
  if (response.destroyed) return
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...(origin === undefined ? {} : {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    }),
  })
  response.end(JSON.stringify(value))
}

/** Answer a preflight; the caller has already admitted the request and its extension Origin. */
function writePreflight(request, response) {
  const origin = request.headers.origin
  response.writeHead(204, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '60',
    'cache-control': 'no-store',
    vary: 'Origin',
  })
  response.end()
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let bytes = 0
  let tooLarge = false
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) {
      tooLarge = true
      continue
    }
    if (!tooLarge) chunks.push(chunk)
  }
  if (tooLarge) {
    const error = new Error('Request body is too large')
    error.statusCode = 413
    throw error
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Request body is not valid JSON')
  }
  if (!isRecord(value)) throw new Error('Request body must be a JSON object')
  return value
}

/** HTTP polling bridge between one DSH browser tool provider and the extension. */
export class BrowserExtensionBridge {
  #pairTokens = new Map()
  #pending = new Map()
  #queue = []
  #cancelled = new Set()
  #pollWaiters = new Set()
  #sessionToken
  #extensionOrigin
  #lastSeen = 0
  #nextRequestId = 0
  #operationTimeoutMs
  #credentials
  #disposeFetch
  #disposeSettings
  #disposeAuthorize
  #disposeRoutes = []
  #pairingGeneration = 0
  #pairingFailures = new FailureWindow(PAIRING_FAILURE_LIMIT)
  #connection
  #closed = false

  /** Load or create the durable code before accepting extension requests. */
  static async create(context, config) {
    const record = await context.credentials.modifyRecord(PAIRING_KEY, async current => {
      if (current === undefined) return { kind: 'api-key', key: randomBytes(18).toString('base64url') }
      if (pairingCodeFrom(current) === undefined) throw new Error('Chrome browser pairing code record is invalid')
      return undefined
    })
    if (pairingCodeFrom(record) === undefined) throw new Error('Chrome browser pairing code is unavailable')
    return new BrowserExtensionBridge(context, config)
  }

  /**
   * Register authenticated pairing and extension routes. Extension routes
   * accept loopback requests and requests whose Host DSH Web trusts.
   * @param {object} context - DSH plugin context with connection and webServer services.
   * @param {{ operationTimeoutMs: number }} config - resolved bridge settings.
   */
  constructor(context, config) {
    this.#operationTimeoutMs = config.operationTimeoutMs
    this.#credentials = context.credentials
    this.#connection = context.connection
    try {
      this.#disposeFetch = context.connection.fetch.register({
        path: PAIR_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => this.#pair(request),
      })
      this.#disposeSettings = context.connection.fetch.register({
        path: PAIRING_SETTINGS_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: request => this.#pairingSettings(request),
      })
      // DSH's normal source check rejects extension origins before route handlers.
      // These exact routes authenticate their own requests in the handlers.
      this.#disposeAuthorize = context.on('webserver/authorize', (request, policy) => {
        if (this.#closed || policy !== 'anonymous' || request.transport !== 'http'
          || !EXTENSION_PATHS.has(request.url?.pathname)
          || (request.method !== 'POST' && request.method !== 'OPTIONS')
          || !isExtensionOrigin(request.headers?.origin)
          || !isAdmittedAuthority(request, this.#connection)) return
        return { kind: 'allow' }
      }, { prepend: true })
      // Register exact routes so the extension handlers own only these paths.
      const extensionRoutes = [
        [AUTHORIZE_PATH, (request, response) => this.#authorizePairingCode(request, response)],
        [CONNECT_PATH, (request, response) => this.#connect(request, response)],
        [POLL_PATH, (request, response) => this.#poll(request, response)],
        [RESPONSE_PATH, (request, response) => this.#respond(request, response)],
        [DISCONNECT_PATH, (request, response) => this.#disconnectRequest(request, response)],
      ]
      for (const [path, handle] of extensionRoutes) {
        const dispose = context.webServer.register({
          kind: 'exact',
          path,
          auth: 'anonymous',
          handler: async (request, response) => {
            if (this.#closed) {
              response.writeHead(503, { 'cache-control': 'no-store' })
              response.end('Browser provider is unloading')
              return
            }
            await handle(request, response)
          },
        })
        context.effect(() => dispose, `dsh-plugin-chrome-controller: ${path}`)
        this.#disposeRoutes.push(dispose)
      }
      context.on('credentials/record-updated', key => {
        if (key !== PAIRING_KEY || this.#closed) return
        this.#pairingGeneration += 1
        this.#clearSession(new Error('Chrome browser pairing code changed'))
      })
    } catch (error) {
      this.#disposeFetch?.()
      this.#disposeSettings?.()
      this.#disposeAuthorize?.()
      for (const dispose of this.#disposeRoutes.splice(0)) dispose()
      throw error
    }
  }

  /** @returns whether an extension session is currently active. */
  get connected() {
    return this.#sessionToken !== undefined && Date.now() - this.#lastSeen <= SESSION_IDLE_MS
  }

  /**
   * Queue one browser operation and wait for the extension response.
   * @param {string} method - fixed browser operation name.
   * @param {object} params - JSON arguments for the operation.
   * @param {AbortSignal} signal - DSH tool cancellation signal.
   * @returns {Promise<object>} extension result.
   */
  request(method, params, signal) {
    signal?.throwIfAborted()
    if (!this.#touchSession()) {
      return Promise.reject(new Error('Chrome extension is disconnected. Check the saved DSH Web origin and pairing code, then click Connect in the extension popup.'))
    }
    const id = 'chrome-' + String(++this.#nextRequestId)
    return new Promise((resolve, reject) => {
      const startedAt = performance.now()
      if (method === 'page.drag') {
        console.info('[dsh-browser-drag-trace]', JSON.stringify({ id, side: 'host', event: 'request-start', at: Date.now(), timeoutMs: this.#operationTimeoutMs }))
      }
      const timer = setTimeout(() => {
        this.#finishRequest(id, new Error('Chrome browser operation timed out'), undefined, true)
      }, this.#operationTimeoutMs)
      const onAbort = () => {
        this.#finishRequest(id, signal.reason instanceof Error ? signal.reason : new Error('Browser operation cancelled'), undefined, true)
      }
      this.#pending.set(id, { resolve, reject, timer, signal, onAbort, delivered: false, method, startedAt })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      if (this.#queue.length >= MAX_QUEUED_COMMANDS) {
        this.#finishRequest(id, new Error('Chrome browser command queue is full'))
        return
      }
      const command = { id, method, params }
      // Hand the command to any waiting poll so several commands can be in
      // flight at once; otherwise queue it for the next poll.
      const waiter = this.#pollWaiters.values().next().value
      if (waiter !== undefined && waiter.token === this.#sessionToken) {
        this.#pending.get(id).delivered = true
        waiter.finish(command)
      }
      else this.#queue.push(command)
    })
  }

  /** Remove HTTP routes and expire pending browser operations. */
  async close() {
    if (this.#closed) return
    this.#closed = true
    try {
      await Promise.all([
        this.#disposeFetch?.(),
        this.#disposeSettings?.(),
        this.#disposeAuthorize?.(),
        ...this.#disposeRoutes.splice(0).map(dispose => Promise.resolve(dispose())),
      ])
    } finally {
      this.#pairTokens.clear()
      this.#clearSession(new Error('Chrome browser provider unloaded'))
    }
  }

  async #currentPairingCode() {
    const code = pairingCodeFrom(await this.#credentials.readRecord(PAIRING_KEY))
    if (code === undefined) throw new Error('Chrome browser pairing code is unavailable')
    return code
  }

  async #pairingSettings(request) {
    if (this.#closed) return new Response('Browser provider is unloading', { status: 503 })
    const wantsJson = request.headers.get('accept')?.includes('application/json') === true
    if (request.method === 'POST') {
      let rotatedCode
      try {
        const record = await this.#credentials.modifyRecord(PAIRING_KEY, async () => ({
          kind: 'api-key', key: randomBytes(18).toString('base64url'),
        }))
        rotatedCode = pairingCodeFrom(record)
        if (rotatedCode === undefined) throw new Error('Rotated pairing code is unavailable')
        this.#pairingGeneration += 1
        this.#clearSession(new Error('Chrome browser pairing code changed'))
      } catch {
        return wantsJson
          ? Response.json({ error: 'Could not rotate the Chrome browser pairing code' }, { status: 503 })
          : new Response('Could not rotate the Chrome browser pairing code', { status: 503 })
      }
      if (wantsJson) return Response.json({ pairingCode: rotatedCode }, {
        headers: { 'cache-control': 'no-store' },
      })
      return new Response(null, { status: 303, headers: {
        location: PAIRING_SETTINGS_PATH,
        'cache-control': 'no-store',
      } })
    }
    let code
    try { code = await this.#currentPairingCode() } catch {
      return wantsJson
        ? Response.json({ error: 'Chrome browser pairing code is unavailable' }, { status: 503 })
        : new Response('Chrome browser pairing code is unavailable', { status: 503 })
    }
    if (wantsJson) return Response.json({ pairingCode: code }, {
      headers: { 'cache-control': 'no-store' },
    })
    const html = '<!doctype html><html lang="en"><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Chrome browser pairing</title><main><h1>Chrome browser pairing</h1>'
      + '<p>Copy this origin and code into the Chrome browser extension Settings page. After saving them, click Connect in the extension popup. The extension will not open a DSH tab.</p>'
      + '<p><label for="dsh-origin">DSH Web origin</label> '
      + '<input id="dsh-origin" type="text" size="48" readonly value="' + escapeHtml(displayedOrigin(request)) + '"></p>'
      + '<label for="pairing-code">Pairing code</label> '
      + '<input id="pairing-code" type="text" size="32" readonly value="' + code + '">'
      + '<p>Rotating the code disconnects the current extension. Save the new code in extension Settings to connect again.</p>'
      + '<form method="post" action="' + PAIRING_SETTINGS_PATH + '">'
      + '<button type="submit">Rotate pairing code</button></form></main></html>'
    return new Response(html, { status: 200, headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    } })
  }

  #issuePairToken() {
    this.#expirePairTokens()
    if (this.#pairTokens.size >= MAX_PAIR_TOKENS) return undefined
    const pairToken = randomBytes(32).toString('base64url')
    this.#pairTokens.set(pairToken, Date.now() + PAIR_LIFETIME_MS)
    return pairToken
  }

  async #pair(_request) {
    if (this.#closed) return new Response('Browser provider is unloading', { status: 503 })
    const pairToken = this.#issuePairToken()
    if (pairToken === undefined) {
      return new Response('Too many pending pairing requests', { status: 429 })
    }
    return new Response(JSON.stringify({ protocol: 1, pairToken }), {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    })
  }

  #crossOriginRequest(request, response) {
    const origin = request.headers.origin
    if (!isExtensionOrigin(origin) || !isAdmittedAuthority(request, this.#connection)) {
      writeJson(response, 403, { error: 'Forbidden' })
      return undefined
    }
    if (request.method === 'OPTIONS') {
      writePreflight(request, response)
      return undefined
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'POST required' }, origin)
      return undefined
    }
    return origin
  }

  async #authorizePairingCode(request, response) {
    const origin = this.#crossOriginRequest(request, response)
    if (origin === undefined) return
    let body
    try { body = await readJsonBody(request, 1024) } catch (error) {
      writeJson(response, error.statusCode ?? 400, { error: error.message }, origin)
      return
    }
    if (this.#pairingFailures.exceeded()) {
      writeJson(response, 429, { error: 'Too many invalid pairing codes; try again later' }, origin)
      return
    }
    const candidate = body.pairingCode
    if (typeof candidate !== 'string' || !PAIRING_CODE_PATTERN.test(candidate)) {
      this.#pairingFailures.record()
      writeJson(response, 401, { error: 'Invalid pairing code' }, origin)
      return
    }
    const generation = this.#pairingGeneration
    let code
    try { code = await this.#currentPairingCode() } catch {
      writeJson(response, 503, { error: 'Pairing code unavailable' }, origin)
      return
    }
    if (generation !== this.#pairingGeneration
      || !timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      this.#pairingFailures.record()
      writeJson(response, 401, { error: 'Invalid pairing code' }, origin)
      return
    }
    this.#pairingFailures.reset()
    const pairToken = this.#issuePairToken()
    if (pairToken === undefined) {
      writeJson(response, 429, { error: 'Too many pending pairing requests' }, origin)
      return
    }
    writeJson(response, 200, { protocol: 1, pairToken }, origin)
  }

  async #connect(request, response) {
    const origin = this.#crossOriginRequest(request, response)
    if (origin === undefined) return
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      writeJson(response, error.statusCode ?? 400, { error: error.message }, origin)
      return
    }
    const expiresAt = typeof body.pairToken === 'string' ? this.#pairTokens.get(body.pairToken) : undefined
    this.#pairTokens.delete(body.pairToken)
    if (expiresAt === undefined || expiresAt < Date.now()) {
      writeJson(response, 401, { error: 'Pairing token expired' }, origin)
      return
    }
    this.#clearSession(new Error('Chrome extension reconnected'))
    this.#sessionToken = randomBytes(32).toString('base64url')
    this.#extensionOrigin = origin
    this.#lastSeen = Date.now()
    writeJson(response, 200, { protocol: 1, sessionToken: this.#sessionToken }, origin)
  }

  async #poll(request, response) {
    const origin = this.#crossOriginRequest(request, response)
    if (origin === undefined) return
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      writeJson(response, error.statusCode ?? 400, { error: error.message }, origin)
      return
    }
    if (!this.#authorizeSession(body.sessionToken, origin, response)) return
    let commands
    try {
      commands = await this.#nextCommands(response, body.sessionToken)
    } catch (error) {
      writeJson(response, 409, { error: error.message }, origin)
      return
    }
    if (response.destroyed) return
    this.#touchSession()
    writeJson(response, 200, { commands, cancelled: [...this.#cancelled] }, origin)
    this.#cancelled.clear()
  }

  async #respond(request, response) {
    const origin = this.#crossOriginRequest(request, response)
    if (origin === undefined) return
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      writeJson(response, error.statusCode ?? 400, { error: error.message }, origin)
      return
    }
    if (!this.#authorizeSession(body.sessionToken, origin, response)) return
    if (typeof body.id !== 'string' || typeof body.ok !== 'boolean') {
      writeJson(response, 400, { error: 'Invalid browser response' }, origin)
      return
    }
    if (body.ok) this.#finishRequest(body.id, undefined, body.result)
    else this.#finishRequest(body.id, new Error(String(body.error?.message ?? 'Chrome browser operation failed')))
    writeJson(response, 200, { ok: true }, origin)
  }

  async #disconnectRequest(request, response) {
    const origin = this.#crossOriginRequest(request, response)
    if (origin === undefined) return
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      writeJson(response, error.statusCode ?? 400, { error: error.message }, origin)
      return
    }
    if (!this.#authorizeSession(body.sessionToken, origin, response)) return
    this.#clearSession(new Error('Chrome extension disconnected'))
    writeJson(response, 200, { ok: true }, origin)
  }

  #authorizeSession(token, origin, response) {
    if (this.#sessionToken === undefined || Date.now() - this.#lastSeen > SESSION_IDLE_MS) {
      this.#clearSession(new Error('Chrome extension session expired'))
      writeJson(response, 401, { error: 'Chrome extension session expired' }, origin)
      return false
    }
    if (typeof token !== 'string' || token !== this.#sessionToken || origin !== this.#extensionOrigin) {
      writeJson(response, 401, { error: 'Chrome extension session expired' }, origin)
      return false
    }
    this.#lastSeen = Date.now()
    return true
  }

  #touchSession() {
    if (this.#sessionToken === undefined) return false
    if (Date.now() - this.#lastSeen > SESSION_IDLE_MS) {
      this.#clearSession(new Error('Chrome extension session expired'))
      return false
    }
    this.#lastSeen = Date.now()
    return true
  }

  #nextCommands(response, token) {
    if (this.#queue.length > 0 || this.#cancelled.size > 0) {
      return Promise.resolve(this.#takeQueuedCommands(MAX_COMMANDS_PER_POLL))
    }
    // A handful of concurrent long-polls is fine (Chrome allows ~6 connections
    // per host); each waiting poll is answered with a batch of queued commands.
    return new Promise(resolve => {
      let finished = false
      let timer
      const waiter = {
        token,
        finish: command => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          response.removeListener('close', onClose)
          this.#pollWaiters.delete(waiter)
          const commands = command === null ? this.#takeQueuedCommands(MAX_COMMANDS_PER_POLL) : [command, ...this.#takeQueuedCommands(MAX_COMMANDS_PER_POLL - 1)]
          if (command !== null) this.#markDelivered(command)
          resolve(commands)
        },
      }
      const onClose = () => waiter.finish(null)
      timer = setTimeout(() => waiter.finish(null), POLL_WAIT_MS)
      this.#pollWaiters.add(waiter)
      response.once('close', onClose)
    })
  }

  #takeQueuedCommands(limit) {
    const commands = this.#queue.splice(0, limit)
    for (const command of commands) this.#markDelivered(command)
    return commands
  }

  #markDelivered(command) {
    const pending = this.#pending.get(command.id)
    if (pending !== undefined) pending.delivered = true
  }

  #expirePairTokens() {
    const now = Date.now()
    for (const [token, expiresAt] of this.#pairTokens) {
      if (expiresAt < now) this.#pairTokens.delete(token)
    }
  }

  #finishRequest(id, error, value, cancelDelivered = false) {
    const pending = this.#pending.get(id)
    if (pending === undefined) return
    if (pending.method === 'page.drag') {
      console.info('[dsh-browser-drag-trace]', JSON.stringify({
        id,
        side: 'host',
        event: error === undefined ? 'request-resolved' : 'request-rejected',
        at: Date.now(),
        elapsedMs: Math.round(performance.now() - pending.startedAt),
        error: error === undefined ? undefined : String(error.message ?? error).slice(0, 200),
      }))
    }
    this.#pending.delete(id)
    clearTimeout(pending.timer)
    pending.signal?.removeEventListener('abort', pending.onAbort)
    this.#queue = this.#queue.filter(command => command.id !== id)
    if (cancelDelivered && pending.delivered) {
      this.#cancelled.add(id)
      const waiter = this.#pollWaiters.values().next().value
      if (waiter !== undefined && waiter.token === this.#sessionToken) waiter.finish(null)
    }
    if (error !== undefined) pending.reject(error)
    else pending.resolve(value)
  }

  #clearSession(reason) {
    this.#pairTokens.clear()
    this.#sessionToken = undefined
    this.#extensionOrigin = undefined
    this.#lastSeen = 0
    this.#queue = []
    this.#cancelled.clear()
    for (const waiter of this.#pollWaiters) waiter.finish(null)
    this.#pollWaiters.clear()
    for (const [id] of this.#pending) this.#finishRequest(id, reason)
  }
}

