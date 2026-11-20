import { DEFAULT_DSH_ORIGIN, normalizeDshOrigin } from './origin.js'

const AUTHORIZE_PATH = '/dsh-browser-extension/authorize'
const CONNECT_PATH = '/dsh-browser-extension/connect'
const POLL_PATH = '/dsh-browser-extension/poll'
const RESPONSE_PATH = '/dsh-browser-extension/respond'
const DISCONNECT_PATH = '/dsh-browser-extension/disconnect'
const SESSION_KEY = 'dshBrowserSession'
const ELEMENT_NOTES_KEY = 'dshElementNotes'
const ELEMENT_NOTE_DRAFT_MS = 10 * 60_000
const ELEMENT_NOTE_MENU_ID = 'dsh-element-note-mode'
const BEHAVIOR_SETTINGS_KEY = 'dshBrowserBehaviorSettings'
const CONNECTION_SETTINGS_KEY = 'dshBrowserConnectionSettings'
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/u
const RECONNECT_ALARM = 'dsh-browser-reconnect'
const RECONNECT_ALARM_PERIOD_MINUTES = 0.5
const RECONNECT_WANTED_KEY = 'dshBrowserReconnectWanted'
const POLL_TIMEOUT_MS = 20_000
// Long-poll workers. Chrome allows only ~6 concurrent connections per host
// (HTTP/1.1), so keep the hanging-poll count well under that; each poll is
// answered by the host with a batch of queued commands.
const MAX_POLL_WORKERS = 4
// Cap on concurrently executing commands: workers receive batches, and this
// semaphore bounds execution at workers * batch. Commands for the same tab are
// serialized host-side, so useful parallelism is bounded by the number of
// distinct tabs; 32 covers realistic fan-out without attaching the debugger to
// hundreds of tabs at once (that degrades the user's Chrome).
const MAX_IN_FLIGHT_COMMANDS = 32
const KEEPALIVE_ALARM = 'dsh-browser-keepalive'
// Chrome 120+ allows 30 s alarm periods for packed extensions; unpacked loads accept it earlier.
const KEEPALIVE_ALARM_PERIOD_MINUTES = 0.5
// MV3 terminates an idle service worker after ~30 s. Calling an extension API on a
// shorter interval resets that idle timer, keeping the poll loop resident.
const KEEPALIVE_INTERVAL_MS = 25_000
const MAX_SNAPSHOT_CHARS = 30_000
const MAX_HTML_CHARS = 100_000
const MAX_SOURCE_CHARS = 100_000
const MAX_EVALUATION_CHARS = 50_000
const MAX_EVALUATION_RESULT_CHARS = 100_000
const MAX_WORKBOOK_CELLS = 10_000
const MAX_WORKBOOK_RESULT_CHARS = 1_000_000
const MAX_FIND_QUERY_CHARS = 2_000
const MAX_FIND_RESULTS = 50
const MAX_FIND_TEXT_CHARS = 300
const MAX_FIND_HREF_CHARS = 2_048
const DEFAULT_EVALUATION_TIMEOUT_MS = 10_000
const MAX_EVALUATION_TIMEOUT_MS = 30_000
const DEFAULT_ELEMENT_WAIT_TIMEOUT_MS = 10_000
const DEFAULT_ELEMENT_WAIT_POLL_INTERVAL_MS = 200
const MAX_ELEMENT_WAIT_TIMEOUT_MS = 25_000
const MIN_ELEMENT_WAIT_POLL_INTERVAL_MS = 50
const MAX_ELEMENT_WAIT_POLL_INTERVAL_MS = 2_000
const MAX_EXPLICIT_WAIT_MS = 25_000
const MAX_HUMAN_TEXT_CHARS = 2_000
// Timing values are interaction defaults, not a validated human-typing model
// and not a way to bypass site automation checks.
const MAX_TYPE_DELAY_MS = 1_000
const DEFAULT_BEHAVIOR_SETTINGS = Object.freeze({
  baseFlightDelayMs: 110,
  flightJitterMinFactor: 0.55,
  flightJitterMaxFactor: 1.45,
  keyHoldMinMs: 50,
  keyHoldVariationMs: 60,
  thinkingPauseChancePercent: 3,
  thinkingPauseMinMs: 400,
  thinkingPauseMaxMs: 900,
  spacePauseMinFactor: 2.2,
  spacePauseMaxFactor: 3.8,
  commonBigramFactor: 0.8,
  repeatedKeyFactor: 1.25,
  cursorSpeedPxPerMs: 1.4,
  cursorMinDurationMs: 120,
  cursorMaxDurationMs: 700,
  cursorArcRatio: 0.22,
  cursorMaxArcPx: 120,
  dragDurationMs: 350,
  sequenceDelayMs: 120,
})
const BEHAVIOR_SETTING_RANGES = Object.freeze({
  baseFlightDelayMs: [0, MAX_TYPE_DELAY_MS],
  flightJitterMinFactor: [0.1, 2],
  flightJitterMaxFactor: [0.1, 3],
  keyHoldMinMs: [0, 500],
  keyHoldVariationMs: [0, 500],
  thinkingPauseChancePercent: [0, 25],
  thinkingPauseMinMs: [100, 5_000],
  thinkingPauseMaxMs: [100, 5_000],
  spacePauseMinFactor: [1, 8],
  spacePauseMaxFactor: [1, 10],
  commonBigramFactor: [0.1, 2],
  repeatedKeyFactor: [1, 4],
  cursorSpeedPxPerMs: [0.1, 5],
  cursorMinDurationMs: [50, 2_000],
  cursorMaxDurationMs: [50, 5_000],
  cursorArcRatio: [0, 0.6],
  cursorMaxArcPx: [0, 500],
  dragDurationMs: [100, 2_000],
  sequenceDelayMs: [0, 1_000],
})
const INTEGER_BEHAVIOR_SETTINGS = new Set([
  'baseFlightDelayMs', 'keyHoldMinMs', 'keyHoldVariationMs', 'thinkingPauseChancePercent',
  'thinkingPauseMinMs', 'thinkingPauseMaxMs', 'cursorMinDurationMs', 'cursorMaxDurationMs',
  'cursorMaxArcPx', 'dragDurationMs', 'sequenceDelayMs',
])
const CURSOR_ARRIVAL_TIMEOUT_MS = 1_500
const DEBUGGER_VIEWPORT_POLL_MS = 100
const DEBUGGER_VIEWPORT_STABLE_SAMPLES = 2
const DEBUGGER_VIEWPORT_MAX_SAMPLES = 10
const NAVIGATION_TIMEOUT_MS = 25_000
const MIN_DRAG_DURATION_MS = 100
const MAX_DRAG_DURATION_MS = 2_000
const MAX_NETWORK_CAPTURE_MS = 10_000
const MAX_NETWORK_REQUESTS = 200
const MAX_NETWORK_RESPONSE_BODIES = 10
const MAX_NETWORK_BODY_CHARS = 20_000
const MAX_NETWORK_RESPONSE_BODY_BYTES = 256 * 1024
const MAX_NETWORK_COOKIES = 500
const MAX_CONSOLE_ENTRIES = 200
const MAX_EXTRACT_ITEMS = 100
const MAX_EXTRACT_CHARS = 50_000
// Base64 inflates by 4/3, so 10 MB stays below the DSH bridge's 20 MB body limit.
const MAX_FETCH_FILE_BYTES = 10 * 1024 * 1024
// A credentialed service-worker retry must be approved by the user in DSH
// within this window, and each token is good for one fetch of one URL.
const FETCH_RETRY_TOKEN_TTL_MS = 5 * 60_000
const MAX_FETCH_RETRY_TOKENS = 20
const fetchRetryTokens = new Map()

let activeSession
let pollController
let pollTask
let restoreTask
let keepaliveInterval
let reconnectWanted = false
let reconnectTask
let trustedStorageTask
let behaviorSettingsCache = { ...DEFAULT_BEHAVIOR_SETTINGS }
let behaviorSettingsLoaded = false
let behaviorSettingsLoadTask
const commandControllers = new Map()
const cancelledCommandIds = new Set()
const completedCommandIds = new Set()
const tabOperationTails = new Map()
const activeDebuggerTargets = new Map()
const debuggerTargetsNeedingFreshCoordinates = new WeakSet()
const dragTraceByTab = new Map()

function normalizeBehaviorSettings(value) {
  const settings = { ...DEFAULT_BEHAVIOR_SETTINGS }
  if (isRecord(value)) {
    for (const [key, [min, max]] of Object.entries(BEHAVIOR_SETTING_RANGES)) {
      const candidate = value[key]
      const validNumber = INTEGER_BEHAVIOR_SETTINGS.has(key)
        ? Number.isSafeInteger(candidate)
        : typeof candidate === 'number' && Number.isFinite(candidate)
      if (validNumber
        && candidate >= min && candidate <= max) settings[key] = candidate
    }
  }
  if (settings.flightJitterMaxFactor < settings.flightJitterMinFactor) {
    settings.flightJitterMinFactor = DEFAULT_BEHAVIOR_SETTINGS.flightJitterMinFactor
    settings.flightJitterMaxFactor = DEFAULT_BEHAVIOR_SETTINGS.flightJitterMaxFactor
  }
  if (settings.thinkingPauseMaxMs < settings.thinkingPauseMinMs) {
    settings.thinkingPauseMinMs = DEFAULT_BEHAVIOR_SETTINGS.thinkingPauseMinMs
    settings.thinkingPauseMaxMs = DEFAULT_BEHAVIOR_SETTINGS.thinkingPauseMaxMs
  }
  if (settings.spacePauseMaxFactor < settings.spacePauseMinFactor) {
    settings.spacePauseMinFactor = DEFAULT_BEHAVIOR_SETTINGS.spacePauseMinFactor
    settings.spacePauseMaxFactor = DEFAULT_BEHAVIOR_SETTINGS.spacePauseMaxFactor
  }
  if (settings.cursorMaxDurationMs < settings.cursorMinDurationMs) {
    settings.cursorMinDurationMs = DEFAULT_BEHAVIOR_SETTINGS.cursorMinDurationMs
    settings.cursorMaxDurationMs = DEFAULT_BEHAVIOR_SETTINGS.cursorMaxDurationMs
  }
  return settings
}

function getBehaviorSettings() {
  if (behaviorSettingsLoaded) return Promise.resolve(behaviorSettingsCache)
  if (behaviorSettingsLoadTask !== undefined) return behaviorSettingsLoadTask
  behaviorSettingsLoadTask = chrome.storage.local.get(BEHAVIOR_SETTINGS_KEY).then(value => {
    behaviorSettingsCache = normalizeBehaviorSettings(value[BEHAVIOR_SETTINGS_KEY])
    behaviorSettingsLoaded = true
    return behaviorSettingsCache
  }).catch(() => {
    behaviorSettingsCache = { ...DEFAULT_BEHAVIOR_SETTINGS }
    behaviorSettingsLoaded = true
    return behaviorSettingsCache
  }).finally(() => {
    behaviorSettingsLoadTask = undefined
  })
  return behaviorSettingsLoadTask
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || changes[BEHAVIOR_SETTINGS_KEY] === undefined) return
  behaviorSettingsCache = normalizeBehaviorSettings(changes[BEHAVIOR_SETTINGS_KEY].newValue)
  behaviorSettingsLoaded = true
  behaviorSettingsLoadTask = undefined
})

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', virtualKey: 13 },
  Tab: { key: 'Tab', code: 'Tab', virtualKey: 9 },
  Escape: { key: 'Escape', code: 'Escape', virtualKey: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', virtualKey: 8 },
  Delete: { key: 'Delete', code: 'Delete', virtualKey: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', virtualKey: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', virtualKey: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', virtualKey: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtualKey: 39 },
  Home: { key: 'Home', code: 'Home', virtualKey: 36 },
  End: { key: 'End', code: 'End', virtualKey: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', virtualKey: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', virtualKey: 34 },
  Space: { key: ' ', code: 'Space', virtualKey: 32, text: ' ' },
}

/** US-layout key descriptors for printable ASCII 32..126. */
function buildCharKeys() {
  const punctuation = {
    ' ': ['Space', 32], '-': ['Minus', 189], '=': ['Equal', 187],
    '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220],
    ';': ['Semicolon', 186], "'": ['Quote', 222], '`': ['Backquote', 192],
    ',': ['Comma', 188], '.': ['Period', 190], '/': ['Slash', 191],
  }
  const map = {}
  for (let code = 32; code <= 126; code++) {
    const char = String.fromCharCode(code)
    const punct = punctuation[char]
    if (punct !== undefined) {
      map[char] = { key: char, code: punct[0], vk: punct[1] }
    } else if (char >= 'a' && char <= 'z') {
      map[char] = { key: char, code: 'Key' + char.toUpperCase(), vk: char.toUpperCase().charCodeAt(0) }
    } else if (char >= 'A' && char <= 'Z') {
      map[char] = { key: char, code: 'Key' + char, vk: char.charCodeAt(0) }
    } else if (char >= '0' && char <= '9') {
      map[char] = { key: char, code: 'Digit' + char, vk: char.charCodeAt(0) }
    }
  }
  const shiftedCharacters = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '~': '`', '<': ',', '>': '.', '?': '/',
  }
  for (const [shifted, unshifted] of Object.entries(shiftedCharacters)) {
    const base = map[unshifted]
    map[shifted] = { ...base, key: shifted, shift: true, unshifted }
  }
  for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const unshifted = char.toLowerCase()
    map[char] = { ...map[unshifted], key: char, shift: true, unshifted }
  }
  return map
}
const CHAR_KEYS = buildCharKeys()

// Frequent English bigrams are typed faster; used to shorten flight time.
const COMMON_BIGRAMS = new Set(['th','he','in','er','an','re','on','at','en','nd','ti','es','or','te','of','ed','is','it','al','ar','st','to','nt','ng','se','as','ou','le','ve','co','me','de','hi','ri','ro','ic','ne','ea','ra','ce','li','ch','ll','be','ma','si','om','ur'])

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

/** Flight time (down-down) before pressing `char`, given the previous char. */
function flightDelayMs(char, prevChar, baseDelayMs, settings) {
  if (Math.random() < settings.thinkingPauseChancePercent / 100) {
    return randomBetween(settings.thinkingPauseMinMs, settings.thinkingPauseMaxMs)
  }
  let delay = baseDelayMs * randomBetween(settings.flightJitterMinFactor, settings.flightJitterMaxFactor)
  if (char === ' ' || '.,!?;:'.includes(char)) {
    delay *= randomBetween(settings.spacePauseMinFactor, settings.spacePauseMaxFactor)
  } else if (prevChar !== '' && COMMON_BIGRAMS.has((prevChar + char).toLowerCase())) {
    delay *= settings.commonBigramFactor
  } else if (prevChar === char) {
    delay *= settings.repeatedKeyFactor
  }
  return Math.round(delay)
}

const KEY_MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8 }

/**
 * Parse a key name or chord like "Enter", "A", "Ctrl+L", "Control+Shift+ArrowRight".
 * Returns a key descriptor with a CDP `modifiers` bitmask, or undefined if unsupported.
 * Dangerous browser chords are refused: Alt+F4 (closes the window), Ctrl/Cmd+W and
 * Ctrl+Shift+W (close tab/window), Ctrl+Shift+Q (quit).
 */
function parseKeyChord(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0) return undefined
  let modifiers = 0
  for (const part of parts.slice(0, -1)) {
    const bit = KEY_MODIFIER_BITS[part.toLowerCase()]
    if (bit === undefined) return undefined
    modifiers |= bit
  }
  const keyName = parts[parts.length - 1]
  const base = KEYS[keyName]
    ?? CHAR_KEYS[keyName]
    ?? CHAR_KEYS[keyName.toLowerCase()]
    ?? CHAR_KEYS[keyName.toUpperCase()]
  if (base === undefined) return undefined
  if (base.shift === true || (modifiers & 8) !== 0) modifiers |= 8
  const keyLower = String(base.key).toLowerCase()
  const isF4 = keyLower === 'f4'
  const isW = keyLower === 'w'
  if ((modifiers & 1) !== 0 && isF4) return undefined
  if (((modifiers & 2) !== 0 || (modifiers & 4) !== 0) && isW) return undefined
  if ((modifiers & 2) !== 0 && (modifiers & 8) !== 0 && keyLower === 'q') return undefined
  const text = (modifiers & ~8) === 0 ? base.text : undefined
  return {
    key: base.key,
    code: base.code,
    virtualKey: base.virtualKey ?? base.vk,
    text,
    modifiers,
  }
}

/** Modifier keys, dispatched around a chord so Chromium's input tracker stays balanced. */
const MODIFIER_KEYS = [
  { bit: 1, key: 'Alt', code: 'AltLeft', vk: 164 },
  { bit: 2, key: 'Control', code: 'ControlLeft', vk: 162 },
  { bit: 4, key: 'Meta', code: 'MetaLeft', vk: 91 },
  { bit: 8, key: 'Shift', code: 'ShiftLeft', vk: 160 },
]

async function dispatchKey(target, type, key, modifiers) {
  await debuggerCommand(target, 'Input.dispatchKeyEvent', {
    type, key: key.key, code: key.code, modifiers,
    windowsVirtualKeyCode: key.vk, nativeVirtualKeyCode: key.vk,
    ...(type === 'keyDown' && key.text !== undefined ? { text: key.text } : {}),
  })
}

/**
 * Press one key, dispatching the modifier keys themselves around it. A synthetic
 * chord that only sets the `modifiers` bitmask leaves Chromium's input tracker
 * believing a modifier is still held, which corrupts later real key events
 * (wrong `code`, so Home arrives as F3 and browser shortcuts misfire) until the
 * browser restarts; balanced modifier keyDown/keyUp pairs prevent that. Every
 * keyDown is released in `finally`, so an aborted press cannot leave a key stuck.
 */
async function pressKey(target, key) {
  const modifiers = key.modifiers ?? 0
  const modifierKeys = MODIFIER_KEYS.filter(m => (modifiers & m.bit) !== 0)
  const pressed = []
  let held = 0
  try {
    for (const m of modifierKeys) {
      held |= m.bit
      await dispatchKey(target, 'keyDown', { key: m.key, code: m.code, vk: m.vk }, held)
      pressed.push({ key: m.key, code: m.code, vk: m.vk, bit: m.bit })
    }
    await dispatchKey(target, 'keyDown', { key: key.key, code: key.code, vk: key.virtualKey, text: key.text }, modifiers)
    pressed.push({ key: key.key, code: key.code, vk: key.virtualKey, bit: 0 })
    await dispatchKey(target, 'keyUp', { key: key.key, code: key.code, vk: key.virtualKey }, modifiers)
    pressed.pop()
  } finally {
    while (pressed.length > 0) {
      const k = pressed.pop()
      held &= ~k.bit
      await dispatchKey(target, 'keyUp', k, held).catch(() => {})
    }
  }
}

/** Type one character with human-like hold and flight timing. */
async function typeCharacter(target, char, prevChar, baseDelayMs, settings, signal) {
  signal?.throwIfAborted()
  await delay(flightDelayMs(char, prevChar, baseDelayMs, settings), signal ?? new AbortController().signal)
  signal?.throwIfAborted()
  if (char === '\n') return pressKey(target, KEYS.Enter)
  if (char === '\t') return pressKey(target, KEYS.Tab)
  const mapping = CHAR_KEYS[char]
  if (mapping === undefined) {
    // Unicode and IME text use CDP insertion when a US-layout key is unavailable.
    await debuggerCommand(target, 'Input.insertText', { text: char })
    return
  }
  const shifted = mapping.shift === true
  const modifiers = shifted ? 8 : 0
  // Dispatch Shift itself for shifted characters; a bare modifiers bitmask
  // leaves the browser's input tracker with Shift held, corrupting later real
  // key events (wrong `code`) until restart. Released in the outer finally.
  if (shifted) {
    await debuggerCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Shift', code: 'ShiftLeft', modifiers,
      windowsVirtualKeyCode: 160, nativeVirtualKeyCode: 160,
    }).catch(() => {})
  }
  try {
    await debuggerCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: mapping.key, code: mapping.code, modifiers,
      windowsVirtualKeyCode: mapping.vk, nativeVirtualKeyCode: mapping.vk,
    })
    try {
      await delay(Math.round(randomBetween(settings.keyHoldMinMs, settings.keyHoldMinMs + settings.keyHoldVariationMs)), signal ?? new AbortController().signal)
      signal?.throwIfAborted()
      await debuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'char', key: mapping.key, code: mapping.code, modifiers,
        text: char, unmodifiedText: mapping.unshifted ?? char,
      })
    } finally {
      await debuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: mapping.key, code: mapping.code, modifiers,
        windowsVirtualKeyCode: mapping.vk, nativeVirtualKeyCode: mapping.vk,
      }).catch(() => {})
    }
  } finally {
    if (shifted) {
      await debuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Shift', code: 'ShiftLeft', modifiers: 0,
        windowsVirtualKeyCode: 160, nativeVirtualKeyCode: 160,
      }).catch(() => {})
    }
  }
}

/** Virtual cursor overlay state (cosmetic; real input always goes via CDP). */
const overlayTabs = new Set()
let cursorMoveSequence = 0
const cursorArrivals = new Map()

async function ensureCursorOverlay(tabId) {
  if (overlayTabs.has(tabId)) return
  await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'], injectImmediately: true })
  overlayTabs.add(tabId)
}

async function sendOverlayControl(tabId, type) {
  try {
    await chrome.tabs.sendMessage(tabId, { type })
  } catch {
    // No overlay in this tab; cosmetic only.
  }
}

/** Animate the virtual cursor overlay to (x, y); optionally wait for arrival. */
async function visualCursorMove(tabId, x, y, waitForArrival, durationMs) {
  try {
    await ensureCursorOverlay(tabId)
    const settings = await getBehaviorSettings()
    const moveSequence = ++cursorMoveSequence
    await chrome.tabs.sendMessage(tabId, {
      type: 'DSH_CURSOR_MOVE', x, y, moveSequence, animate: true,
      ...(Number.isFinite(durationMs) ? { durationMs } : {}),
      cursorSettings: {
        speedPxPerMs: settings.cursorSpeedPxPerMs,
        minDurationMs: settings.cursorMinDurationMs,
        maxDurationMs: settings.cursorMaxDurationMs,
        arcRatio: settings.cursorArcRatio,
        maxArcPx: settings.cursorMaxArcPx,
      },
    })
    if (!waitForArrival) return
    await new Promise(resolve => {
      const finish = () => {
        cursorArrivals.delete(moveSequence)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, CURSOR_ARRIVAL_TIMEOUT_MS)
      cursorArrivals.set(moveSequence, finish)
    })
  } catch {
    // Overlay is best-effort; real CDP input proceeds regardless.
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function requireCssSelector(value, description = 'The CSS selector') {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1000) {
    throw new Error(description + ' is invalid')
  }
  return value
}

/** Return the main document's root nodeId. */
async function rootNodeId(target) {
  const document = await debuggerCommand(target, 'DOM.getDocument', { depth: 0, pierce: true })
  const nodeId = document.root?.nodeId
  if (!Number.isInteger(nodeId)) throw new Error('The page document is unavailable')
  return nodeId
}

async function viewportSize(target) {
  const response = await debuggerCommand(target, 'Runtime.evaluate', {
    expression: '({ width: window.innerWidth, height: window.innerHeight })',
    returnByValue: true,
  })
  const value = response.result?.value
  if (!isRecord(value) || !Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    throw new Error('The page viewport could not be read')
  }
  return value
}

async function waitForStableViewport(target) {
  let previous
  let stableSamples = 0
  for (let sample = 0; sample < DEBUGGER_VIEWPORT_MAX_SAMPLES; sample++) {
    const current = await viewportSize(target)
    if (previous !== undefined
      && current.width === previous.width && current.height === previous.height) {
      stableSamples++
      if (stableSamples >= DEBUGGER_VIEWPORT_STABLE_SAMPLES) return current
    } else {
      stableSamples = 0
    }
    previous = current
    await delay(DEBUGGER_VIEWPORT_POLL_MS, new AbortController().signal)
  }
  return previous
}

async function resolveElementPoint(target, params) {
  const nodeId = await querySelectorNode(target, params.selector)
  let info = await callNodeFunction(target, nodeId, CLICK_INFO_FUNCTION)
  if (!isRecord(info) || !isRecord(info.rect)) throw new Error('The selected element could not be inspected')
  let x = (info.rect.left + info.rect.right) / 2
  let y = (info.rect.top + info.rect.bottom) / 2
  const inViewport = () => x >= 0 && y >= 0 && x < info.viewportWidth && y < info.viewportHeight
  if (!inViewport()) {
    const scrollInfo = await callNodeFunction(target, nodeId, SCROLL_TO_VIEW_FUNCTION)
    if (!isRecord(scrollInfo) || scrollInfo.visible !== true) {
      throw new Error('The selected element could not be brought into the viewport')
    }
    info = await callNodeFunction(target, nodeId, CLICK_INFO_FUNCTION)
    if (!isRecord(info) || !isRecord(info.rect)) throw new Error('The selected element could not be inspected after scrolling')
    x = (info.rect.left + info.rect.right) / 2
    y = (info.rect.top + info.rect.bottom) / 2
  }
  if (info.pointerEvents === 'none' || !inViewport()) {
    throw new Error('The selected element is not reachable at its center point')
  }
  const hitTarget = await callNodeFunction(target, nodeId, CLICK_HIT_TEST_FUNCTION, [x, y])
  if (hitTarget !== true) throw new Error('The selected element is covered at its center point')
  return { x, y }
}

/** Resolve a CSS selector against the main document and require exactly one match. */
async function querySelectorNode(target, selector) {
  const document = await debuggerCommand(target, 'DOM.getDocument', { depth: 1, pierce: true })
  const rootId = document.root?.nodeId
  if (!Number.isInteger(rootId)) throw new Error('The page document is unavailable')
  const result = await debuggerCommand(target, 'DOM.querySelectorAll', { nodeId: rootId, selector })
  const nodeIds = Array.isArray(result.nodeIds) ? result.nodeIds : []
  if (nodeIds.length === 0) throw new Error('The CSS selector did not match an element')
  if (nodeIds.length !== 1) throw new Error('The CSS selector matched more than one element')
  if (!Number.isInteger(nodeIds[0]) || nodeIds[0] === 0) throw new Error('The selected element is unavailable')
  return nodeIds[0]
}

/** Resolve a CSS selector to a remote object id for Runtime.callFunctionOn. */
async function querySelectorObjectId(target, selector) {
  const nodeId = await querySelectorNode(target, selector)
  const resolved = await debuggerCommand(target, 'DOM.resolveNode', { nodeId })
  const objectId = resolved.object?.objectId
  if (typeof objectId !== 'string') throw new Error('The selected element cannot be controlled')
  return objectId
}

async function callNodeFunction(target, nodeId, functionDeclaration, args = []) {
  const resolved = await debuggerCommand(target, 'DOM.resolveNode', { nodeId })
  const objectId = resolved.object?.objectId
  if (typeof objectId !== 'string') throw new Error('The selected element cannot be controlled')
  const response = await debuggerCommand(target, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args.map(value => ({ value })),
    returnByValue: true,
  })
  if (response.exceptionDetails !== undefined) {
    const detail = response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? 'The selected element could not be inspected'
    throw new Error(String(detail))
  }
  return response.result?.value
}

const CLICK_INFO_FUNCTION = `function () {
  const el = this
  const style = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return {
    disabled: el.disabled === true || el.matches(':disabled')
      || el.getAttribute('aria-disabled')?.toLowerCase() === 'true'
      || el.closest('[inert]') !== null,
    pointerEvents: style.pointerEvents,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
  }
}`

const CLICK_HIT_TEST_FUNCTION = `function (x, y) {
  let root = this.getRootNode()
  let hit = document.elementFromPoint(x, y)
  while (root instanceof ShadowRoot) {
    const shadowHit = root.elementFromPoint?.(x, y)
    if (shadowHit !== null && shadowHit !== undefined) hit = shadowHit
    if (hit === this || (hit !== null && this.contains(hit))) return true
    if (hit === root.host) return true
    root = root.host.getRootNode()
  }
  return hit === this || (hit !== null && this.contains(hit))
}`

const SCROLL_TO_VIEW_FUNCTION = `function () {
  this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = this.getBoundingClientRect()
  const width = window.innerWidth
  const height = window.innerHeight
  return {
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width, height,
    visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
      && rect.left < width && rect.top < height,
  }
}`

/** Runs with `this` bound to the selected field; validates it and selects its text. */
const FILL_PREPARE_FUNCTION = `function () {
  const el = this
  const inputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])
  const isTextarea = el instanceof HTMLTextAreaElement
  const isTextInput = el instanceof HTMLInputElement && inputTypes.has(el.type)
  const isEditable = el.isContentEditable
  if (!isTextarea && !isTextInput && !isEditable) {
    throw new Error('The selected element is not a text field')
  }
  if (el.disabled === true || el.matches(':disabled')
    || el.getAttribute('aria-disabled')?.toLowerCase() === 'true') {
    throw new Error('The selected field is disabled')
  }
  if (el.readOnly === true || el.getAttribute('aria-readonly')?.toLowerCase() === 'true') {
    throw new Error('The selected field is read-only')
  }
  el.focus()
  if (isTextarea || isTextInput) {
    if (el instanceof HTMLInputElement && el.type === 'number') return { selectAllByKey: true }
    el.select()
  } else {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return { selectAllByKey: false }
}`

const FILL_CHANGE_FUNCTION = `function () {
  this.dispatchEvent(new Event('change', { bubbles: true }))
}`

/** Runs with `this` bound to a form or one of its controls; attempts requestSubmit. */
const SUBMIT_FUNCTION = `function (submitter) {
  const el = this
  const form = el instanceof HTMLFormElement ? el
    : (el.form instanceof HTMLFormElement ? el.form : el.closest('form'))
  if (!(form instanceof HTMLFormElement)) throw new Error('The selected element is not in a form')
  if (submitter !== undefined) {
    if (!(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement)
      || (submitter instanceof HTMLButtonElement && submitter.type !== 'submit')
      || (submitter instanceof HTMLInputElement && submitter.type !== 'submit' && submitter.type !== 'image')
      || submitter.form !== form) {
      throw new Error('The submitter must be a submit control associated with the selected form')
    }
    if (submitter.disabled || submitter.matches(':disabled')) throw new Error('The submitter is disabled')
  }
  if (typeof form.requestSubmit !== 'function') throw new Error('This page does not support requestSubmit')
  const validationSkipped = form.noValidate === true || submitter?.formNoValidate === true
  const valid = Array.from(form.elements).every(control => !control.willValidate || control.validity.valid)
  form.requestSubmit(submitter)
  return { valid, validationSkipped }
}`

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Polling stopped'))
      return
    }
    const timer = setTimeout(finish, ms)
    function finish() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new Error('Polling stopped'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Response upload timeout. Only page.fetchFile and page.fetchFileRetry results carry file bytes large
 * enough to need more: 10 s plus 10 s per MB of base64. Every other operation
 * keeps the default 10 s.
 */
function responseTimeoutMs(method, result) {
  if ((method !== 'page.fetchFile' && method !== 'page.fetchFileRetry') || typeof result?.base64 !== 'string') return 10_000
  return 10_000 + Math.ceil(result.base64.length / (1024 * 1024)) * 10_000
}

async function postJson(origin, path, payload, sessionSignal, timeoutMs = 10_000) {
  const controller = new AbortController()
  const abortFromSession = () => controller.abort(sessionSignal.reason)
  if (sessionSignal?.aborted) abortFromSession()
  else sessionSignal?.addEventListener('abort', abortFromSession, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('Local DSH request timed out')), timeoutMs)
  try {
    const response = await fetch(new URL(path, origin), {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const value = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(typeof value?.error === 'string' ? value.error : 'Local DSH request failed')
      error.status = response.status
      throw error
    }
    return value
  } finally {
    clearTimeout(timer)
    sessionSignal?.removeEventListener('abort', abortFromSession)
  }
}

/** Exchange the saved pairing code for a short-lived token without a page tab. */
async function requestPairTokenFromWorker(origin, pairingCode) {
  const result = await postJson(origin, AUTHORIZE_PATH, { pairingCode })
  if (!isRecord(result) || result.protocol !== 1 || typeof result.pairToken !== 'string') {
    throw new Error('DSH Web returned an invalid pairing response')
  }
  return result.pairToken
}

async function pairWithDsh(origin, pairingCode) {
  await disconnect()
  const pairToken = await requestPairTokenFromWorker(origin, pairingCode)
  const result = await postJson(origin, CONNECT_PATH, { pairToken })
  if (!isRecord(result) || result.protocol !== 1 || typeof result.sessionToken !== 'string') {
    throw new Error('DSH Web returned an invalid browser session')
  }
  activeSession = { origin, sessionToken: result.sessionToken }
  await chrome.storage.session.set({ [SESSION_KEY]: activeSession })
  stopReconnect()
  startKeepalive()
  startPollLoop(activeSession)
}

/** Create the heartbeat alarm once; alarms persist and wake a suspended service worker. */
async function ensureKeepalive() {
  if (activeSession === undefined) return
  try {
    if (await chrome.alarms.get(KEEPALIVE_ALARM) === undefined) {
      if (activeSession === undefined) return
      await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_ALARM_PERIOD_MINUTES })
    }
  } catch {
    // Keep-alive is best-effort; pairing still works while the worker stays resident.
  }
}

/** Reset the MV3 idle timer on an interval and schedule the wake-up heartbeat alarm. */
function startKeepalive() {
  if (activeSession === undefined || keepaliveInterval !== undefined) return
  void ensureKeepalive()
  keepaliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {})
  }, KEEPALIVE_INTERVAL_MS)
}

function stopKeepalive() {
  if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval)
  keepaliveInterval = undefined
  void chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {})
}

function startPollLoop(session) {
  if (pollTask !== undefined && activeSession?.sessionToken === session.sessionToken) return
  pollController?.abort(new Error('Replacing Chrome browser poll loop'))
  const controller = new AbortController()
  pollController = controller
  const task = pollLoop(session, controller.signal).finally(() => {
    if (pollController === controller) pollController = undefined
    if (pollTask === task) pollTask = undefined
    if (activeSession?.sessionToken === session.sessionToken && !controller.signal.aborted) {
      void clearSession(session)
    }
  })
  pollTask = task
}

let inFlightCommands = 0
const commandSlotWaiters = []

function acquireCommandSlot() {
  if (inFlightCommands < MAX_IN_FLIGHT_COMMANDS) {
    inFlightCommands += 1
    return Promise.resolve()
  }
  return new Promise(resolve => commandSlotWaiters.push(resolve))
}

function releaseCommandSlot() {
  inFlightCommands -= 1
  const next = commandSlotWaiters.shift()
  if (next !== undefined) {
    inFlightCommands += 1
    next()
  }
}

async function pollLoop(session, signal) {
  // A few long-poll workers (bounded by Chrome's per-host connection limit) each
  // receive batches of queued commands; the semaphore caps concurrent execution
  // at MAX_IN_FLIGHT_COMMANDS so different tabs are driven in parallel without
  // drowning the browser.
  const workers = []
  for (let i = 0; i < MAX_POLL_WORKERS; i++) workers.push(pollWorker(session, signal))
  await Promise.allSettled(workers)
}

async function pollWorker(session, signal) {
  let failures = 0
  while (!signal.aborted && activeSession?.sessionToken === session.sessionToken) {
    try {
      const value = await postJson(
        session.origin,
        POLL_PATH,
        { sessionToken: session.sessionToken },
        signal,
        POLL_TIMEOUT_MS,
      )
      failures = 0
      for (const id of Array.isArray(value?.cancelled) ? value.cancelled : []) {
        if (typeof id !== 'string') continue
        if (completedCommandIds.has(id)) continue
        const controller = commandControllers.get(id)
        if (controller !== undefined) controller.abort(new Error('Browser operation was cancelled by DSH'))
        else cancelledCommandIds.add(id)
      }
      const commands = Array.isArray(value?.commands)
        ? value.commands
        : value?.command == null ? [] : [value.command]
      for (const command of commands) {
        // Dispatch without blocking this worker: take an execution slot, run the
        // command, then release the slot. The worker polls again immediately.
        void (async () => {
          await acquireCommandSlot()
          if (cancelledCommandIds.delete(command.id)) {
            releaseCommandSlot()
            return
          }
          const commandController = new AbortController()
          const abortCommand = () => commandController.abort(signal.reason ?? new Error('Browser session ended'))
          signal.addEventListener('abort', abortCommand, { once: true })
          commandControllers.set(command.id, commandController)
          try {
            await handleBrowserRequest(session, command, signal, commandController.signal)
          } catch {
            // handleBrowserRequest already reports failures to the host.
          } finally {
            signal.removeEventListener('abort', abortCommand)
            commandControllers.delete(command.id)
            cancelledCommandIds.delete(command.id)
            completedCommandIds.add(command.id)
            if (completedCommandIds.size > 512) completedCommandIds.delete(completedCommandIds.values().next().value)
            releaseCommandSlot()
          }
        })()
      }
    } catch (error) {
      if (signal.aborted || activeSession?.sessionToken !== session.sessionToken) break
      if (error?.status === 401 || error?.status === 403) {
        await clearSession(session)
        break
      }
      failures += 1
      if (failures >= 5) {
        await clearSession(session)
        break
      }
      try {
        await delay(Math.min(1000 * failures, 5000), signal)
      } catch {
        break
      }
    }
  }
}

async function handleBrowserRequest(session, command, signal, commandSignal) {
  if (!isRecord(command) || typeof command.id !== 'string' || typeof command.method !== 'string'
    || !isRecord(command.params ?? {})) {
    await postJson(session.origin, RESPONSE_PATH, {
      sessionToken: session.sessionToken,
      id: typeof command?.id === 'string' ? command.id : 'invalid',
      ok: false,
      error: { message: 'DSH sent an invalid browser command' },
    }, signal).catch(() => {})
    return
  }
  const dragTabId = command.method === 'page.drag' && Number.isSafeInteger(command.params?.tabId)
    ? command.params.tabId
    : undefined
  const dragTraceId = dragTabId === undefined ? undefined : command.id
  if (dragTraceId !== undefined) {
    dragTraceByTab.set(dragTabId, dragTraceId)
    logDragTrace(dragTraceId, 'command-received')
  }
  try {
    if (dragTraceId !== undefined) logDragTrace(dragTraceId, 'operation-start')
    const result = await executeBrowserOperation(command.method, command.params ?? {}, commandSignal)
    if (dragTraceId !== undefined) logDragTrace(dragTraceId, 'operation-finished')
    if (dragTraceId !== undefined) logDragTrace(dragTraceId, 'response-post-start')
    await postJson(session.origin, RESPONSE_PATH, {
      sessionToken: session.sessionToken,
      id: command.id,
      ok: true,
      result,
    }, signal, responseTimeoutMs(command.method, result))
    if (dragTraceId !== undefined) logDragTrace(dragTraceId, 'response-post-finished')
  } catch (error) {
    if (dragTraceId !== undefined) logDragTrace(dragTraceId, 'operation-or-response-error', {
      error: String(error instanceof Error ? error.message : error).slice(0, 200),
    })
    await postJson(session.origin, RESPONSE_PATH, {
      sessionToken: session.sessionToken,
      id: command.id,
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    }, signal).catch(() => {})
  } finally {
    if (dragTraceId !== undefined) {
      if (dragTraceByTab.get(dragTabId) === dragTraceId) dragTraceByTab.delete(dragTabId)
      logDragTrace(dragTraceId, 'command-finished')
    }
  }
}

function logDragTrace(id, event, details = {}) {
  console.info('[dsh-browser-drag-trace]', JSON.stringify({
    id,
    side: 'extension',
    event,
    at: Date.now(),
    elapsedMs: details.elapsedMs,
    method: details.method,
    error: details.error,
  }))
}

function ensureTrustedLocalStorage() {
  trustedStorageTask ??= chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(error => { trustedStorageTask = undefined; throw error })
  return trustedStorageTask
}

/** Read the configured origin and the persistent code supplied by the user. */
async function readConnectionSettings() {
  await ensureTrustedLocalStorage()
  const stored = await chrome.storage.local.get(CONNECTION_SETTINGS_KEY)
  const settings = stored?.[CONNECTION_SETTINGS_KEY]
  const origin = settings?.origin === undefined ? DEFAULT_DSH_ORIGIN : normalizeDshOrigin(settings.origin)
  if (origin === undefined) throw new Error('Set a loopback or HTTPS DSH Web address in Settings')
  return {
    origin,
    pairingCode: typeof settings?.pairingCode === 'string' ? settings.pairingCode.trim() : '',
    autoConnect: settings?.autoConnect !== false,
  }
}

/** Keep the reconnect alarm armed until a session exists again. */
async function scheduleReconnect() {
  if (activeSession !== undefined) return
  reconnectWanted = true
  try { await chrome.storage.local.set({ [RECONNECT_WANTED_KEY]: true }) } catch {
    // The alarm still retries while this worker is alive.
  }
  try {
    if (await chrome.alarms.get(RECONNECT_ALARM) === undefined) {
      await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_ALARM_PERIOD_MINUTES })
    }
  } catch {
    // best effort
  }
}

/** Stop automatic reconnection (explicit user disconnect or successful pair). */
function stopReconnect() {
  reconnectWanted = false
  void chrome.storage.local.remove(RECONNECT_WANTED_KEY).catch(() => {})
  void chrome.alarms.clear(RECONNECT_ALARM).catch(() => {})
}

/**
 * Re-pair automatically after an unexpected session loss (host restart, expired
 * token, network drop), on Chrome startup when autoConnect is enabled, or when the
 * user clicks Connect. Uses the saved origin and code without creating a tab.
 */
async function attemptAutoReconnect() {
  if (activeSession !== undefined) return
  if (!reconnectWanted) return
  if (reconnectTask !== undefined) return reconnectTask
  reconnectTask = (async () => {
    const settings = await readConnectionSettings()
    if (!PAIRING_CODE_PATTERN.test(settings.pairingCode)) {
      throw new Error('Save the pairing code from DSH Web in extension Settings')
    }
    try {
      await pairWithDsh(settings.origin, settings.pairingCode)
    } catch (error) {
      if (error?.status === 401) stopReconnect()
      throw error
    }
  })().finally(() => {
    reconnectTask = undefined
  })
  return reconnectTask
}

async function clearSession(session, options = {}) {
  if (activeSession?.sessionToken !== session.sessionToken) return
  activeSession = undefined
  completedCommandIds.clear()
  cancelledCommandIds.clear()
  pollController?.abort(new Error('Chrome browser session ended'))
  stopKeepalive()
  await detachAllDebuggerTargets()
  await chrome.storage.session.remove(SESSION_KEY)
  if (options.autoReconnect !== false) {
    const settings = await readConnectionSettings().catch(() => undefined)
    if (settings?.autoConnect === true && PAIRING_CODE_PATTERN.test(settings.pairingCode)) {
      await scheduleReconnect()
      // Defer: pairWithDsh waits for the previous poll task, which is the caller here.
      setTimeout(() => { void attemptAutoReconnect().catch(() => {}) }, 50)
    }
  }
}

async function disconnect() {
  const session = activeSession
  const previousPoll = pollTask
  activeSession = undefined
  completedCommandIds.clear()
  cancelledCommandIds.clear()
  pollController?.abort(new Error('Disconnected by user'))
  stopKeepalive()
  pollController = undefined
  await detachAllDebuggerTargets()
  await chrome.storage.session.remove(SESSION_KEY)
  if (session !== undefined) {
    await postJson(session.origin, DISCONNECT_PATH, { sessionToken: session.sessionToken }, undefined, 3000).catch(() => {})
  }
  await previousPoll?.catch(() => {})
  if (pollTask === previousPoll) pollTask = undefined
}

async function restoreSession() {
  if (restoreTask !== undefined) return restoreTask
  restoreTask = chrome.storage.session.get(SESSION_KEY).then(async value => {
    const session = value[SESSION_KEY]
    if (isRecord(session) && typeof session.origin === 'string' && typeof session.sessionToken === 'string') {
      activeSession = session
      startKeepalive()
      if (pollTask === undefined) startPollLoop(session)
      return
    }
    stopKeepalive()
    // Resume an interrupted auto-reconnect (e.g. the worker was recycled mid-retry).
    const wanted = await chrome.storage.local.get(RECONNECT_WANTED_KEY).catch(() => ({}))
    if (wanted?.[RECONNECT_WANTED_KEY] === true) {
      const settings = await readConnectionSettings().catch(() => undefined)
      if (settings?.autoConnect === true && PAIRING_CODE_PATTERN.test(settings.pairingCode)) {
        reconnectWanted = true
        await scheduleReconnect()
        void attemptAutoReconnect().catch(() => {})
      } else stopReconnect()
    }
  }).catch(() => {}).finally(() => {
    restoreTask = undefined
  })
  return restoreTask
}

function normalizeSequenceCommand(params, defaultDelayMs = DEFAULT_BEHAVIOR_SETTINGS.sequenceDelayMs) {
  const tabId = requireTabId(params.tabId)
  if (!Array.isArray(params.steps) || params.steps.length < 1 || params.steps.length > 25) {
    throw new Error('A browser sequence must contain between 1 and 25 actions')
  }
  const interActionDelayMs = params.interActionDelayMs === undefined ? defaultDelayMs : params.interActionDelayMs
  if (!Number.isSafeInteger(interActionDelayMs) || interActionDelayMs < 0 || interActionDelayMs > 1000) {
    throw new Error('interActionDelayMs must be an integer between 0 and 1000')
  }
  const specs = {
    click: { method: 'page.click', required: [], allowed: ['selector', 'x', 'y'] },
    type_human: { method: 'page.typeHuman', required: ['text'], allowed: ['text', 'selector', 'delayMs'] },
    fill: { method: 'page.fill', required: ['selector', 'text'], allowed: ['selector', 'text', 'delayMs'] },
    keypress: { method: 'page.keypress', required: ['key'], allowed: ['key'] },
    mouse_move: { method: 'page.mouseMove', required: [], allowed: ['selector', 'x', 'y'] },
    drag: { method: 'page.drag', required: [], allowed: ['fromSelector', 'toSelector', 'fromX', 'fromY', 'toX', 'toY', 'durationMs'] },
    scroll: { method: 'page.scroll', required: [], allowed: ['selector', 'deltaX', 'deltaY'] },
    navigate: { method: 'page.navigate', required: ['url'], allowed: ['url'] },
    back: { method: 'page.back', required: [], allowed: [] },
    forward: { method: 'page.forward', required: [], allowed: [] },
    reload: { method: 'page.reload', required: [], allowed: [] },
    wait: { method: 'page.wait', required: ['durationMs'], allowed: ['durationMs'] },
    wait_for_element: { method: 'page.waitForElement', required: ['selector'], allowed: ['selector', 'state', 'timeoutMs', 'pollIntervalMs'] },
    evaluate: { method: 'page.evaluate', required: ['expression'], allowed: ['expression', 'timeoutMs'] },
    snapshot: { method: 'page.snapshot', required: [], allowed: ['maxChars'] },
    get_html: { method: 'page.html', required: [], allowed: ['selector', 'maxChars'] },
    get_source: { method: 'page.source', required: [], allowed: ['maxChars'] },
    extract: { method: 'page.extract', required: ['kind'], allowed: ['kind', 'selector', 'maxItems', 'maxChars'] },
    focus: { method: 'page.focus', required: ['selector'], allowed: ['selector'] },
    blur: { method: 'page.blur', required: ['selector'], allowed: ['selector'] },
    select: { method: 'page.selectOption', required: ['selector'], allowed: ['selector', 'value', 'label', 'index'] },
  }
  const steps = params.steps.map((step, index) => {
    if (!isRecord(step) || typeof step.action !== 'string' || !isRecord(step.params)) {
      throw new Error('Sequence step ' + String(index + 1) + ' is malformed')
    }
    if (Object.keys(step).some(key => !['action', 'method', 'params'].includes(key))) {
      throw new Error('Sequence step ' + String(index + 1) + ' has unexpected fields')
    }
    const spec = specs[step.action]
    if (spec === undefined || step.method !== spec.method) {
      throw new Error('Sequence step ' + String(index + 1) + ' has an unsupported action')
    }
    const stepParams = step.params
    if (stepParams.tabId !== tabId) throw new Error('Every sequence step must use the sequence tabId')
    for (const key of Object.keys(stepParams)) {
      if (key !== 'tabId' && !spec.allowed.includes(key)) {
        throw new Error('Sequence step ' + String(index + 1) + ' does not accept ' + key)
      }
    }
    for (const key of spec.required) {
      if (stepParams[key] === undefined) throw new Error('Sequence step ' + String(index + 1) + ' requires ' + key)
    }
    if (step.action === 'select') {
      const choices = ['value', 'label', 'index'].filter(key => stepParams[key] !== undefined)
      if (choices.length !== 1) throw new Error('Sequence select step must provide exactly one of value, label, or index')
    }
    for (const key of spec.allowed) {
      const value = stepParams[key]
      if (value === undefined) continue
      const expected = ['x', 'y', 'fromX', 'fromY', 'toX', 'toY'].includes(key) ? 'number'
        : ['delayMs', 'timeoutMs', 'maxChars', 'maxItems', 'durationMs', 'pollIntervalMs', 'index'].includes(key) ? 'integer'
            : 'string'
      const valid = expected === 'integer' ? Number.isSafeInteger(value)
        : expected === 'number' ? Number.isFinite(value)
          : typeof value === expected
      if (!valid) throw new Error('Sequence step ' + String(index + 1) + ' has invalid ' + key)
    }
    if (step.action === 'click' && stepParams.selector === undefined
      && !(Number.isFinite(stepParams.x) && Number.isFinite(stepParams.y))) {
      throw new Error('Sequence click step ' + String(index + 1) + ' requires a selector or both x and y')
    }
    if (step.action === 'click' && stepParams.selector !== undefined
      && (stepParams.x !== undefined || stepParams.y !== undefined)) {
      throw new Error('Sequence click step ' + String(index + 1) + ' must use a selector or coordinates, not both')
    }
    if (step.action === 'mouse_move') {
      const hasSelector = stepParams.selector !== undefined
      const hasCoordinates = stepParams.x !== undefined || stepParams.y !== undefined
      if (hasSelector === hasCoordinates || (hasCoordinates && !(Number.isFinite(stepParams.x) && Number.isFinite(stepParams.y)))) {
        throw new Error('Sequence mouse_move step ' + String(index + 1) + ' requires a selector or both coordinates')
      }
    }
    if (step.action === 'scroll') {
      const hasSelector = stepParams.selector !== undefined
      const hasDelta = stepParams.deltaX !== undefined || stepParams.deltaY !== undefined
      if (hasSelector === hasDelta) throw new Error('Sequence scroll step ' + String(index + 1) + ' requires a selector or scroll deltas')
      if ([stepParams.deltaX, stepParams.deltaY].some(value => value !== undefined && Math.abs(value) > 10_000)) {
        throw new Error('Sequence scroll step ' + String(index + 1) + ' has out-of-range deltas')
      }
    }
    if (step.action === 'drag') {
      const hasSelectors = stepParams.fromSelector !== undefined || stepParams.toSelector !== undefined
      const coordinateKeys = ['fromX', 'fromY', 'toX', 'toY']
      const hasCoordinates = coordinateKeys.some(key => stepParams[key] !== undefined)
      if (hasSelectors === hasCoordinates
        || (hasSelectors && (stepParams.fromSelector === undefined || stepParams.toSelector === undefined))
        || (hasCoordinates && !coordinateKeys.every(key => Number.isFinite(stepParams[key])))) {
        throw new Error('Sequence drag step ' + String(index + 1) + ' requires two selectors or all four coordinates')
      }
      if (coordinateKeys.some(key => stepParams[key] !== undefined && (stepParams[key] < 0 || stepParams[key] > 10_000))) {
        throw new Error('Sequence drag step ' + String(index + 1) + ' has out-of-range coordinates')
      }
      if (stepParams.durationMs !== undefined
        && (stepParams.durationMs < MIN_DRAG_DURATION_MS || stepParams.durationMs > MAX_DRAG_DURATION_MS)) {
        throw new Error('Sequence drag step ' + String(index + 1) + ' has out-of-range durationMs')
      }
      for (const key of ['fromSelector', 'toSelector']) {
        if (stepParams[key] !== undefined) requireCssSelector(stepParams[key], 'The drag CSS selector')
      }
    }
    if (step.action === 'wait' && (stepParams.durationMs < 0 || stepParams.durationMs > MAX_EXPLICIT_WAIT_MS)) {
      throw new Error('Sequence wait step ' + String(index + 1) + ' durationMs must be between 0 and 25000')
    }
    if (step.action === 'wait_for_element') {
      requireCssSelector(stepParams.selector, 'The wait CSS selector')
      if (stepParams.state !== undefined && !['visible', 'hidden', 'attached', 'detached'].includes(stepParams.state)) {
        throw new Error('Sequence wait_for_element step ' + String(index + 1) + ' has an invalid state')
      }
      const timeoutMs = stepParams.timeoutMs ?? DEFAULT_ELEMENT_WAIT_TIMEOUT_MS
      const pollIntervalMs = stepParams.pollIntervalMs ?? DEFAULT_ELEMENT_WAIT_POLL_INTERVAL_MS
      if (timeoutMs < 1 || timeoutMs > MAX_EXPLICIT_WAIT_MS
        || pollIntervalMs < MIN_ELEMENT_WAIT_POLL_INTERVAL_MS
        || pollIntervalMs > MAX_ELEMENT_WAIT_POLL_INTERVAL_MS) {
        throw new Error('Sequence wait_for_element step ' + String(index + 1) + ' has out-of-range timing')
      }
    }
    if (['click', 'type_human', 'fill', 'get_html', 'scroll', 'focus', 'blur', 'select', 'extract', 'mouse_move'].includes(step.action)
      && stepParams.selector !== undefined) {
      requireCssSelector(stepParams.selector)
    }
    if (['type_human', 'fill'].includes(step.action)) {
      const max = MAX_HUMAN_TEXT_CHARS
      if (stepParams.text.length > max || (step.action === 'type_human' && stepParams.text.length === 0)) {
        throw new Error('Sequence step ' + String(index + 1) + ' has text outside the supported length')
      }
      if (step.action === 'fill' && /[\r\n\t]/u.test(stepParams.text)) {
        throw new Error('Sequence fill step ' + String(index + 1) + ' cannot contain tabs or line breaks')
      }
    }
    if (step.action === 'keypress' && KEYS[stepParams.key] === undefined && parseKeyChord(stepParams.key) === undefined) {
      throw new Error('Sequence step ' + String(index + 1) + ' has an unsupported key')
    }
    if (['click', 'mouse_move'].includes(step.action)) {
      for (const key of ['x', 'y']) {
        if (stepParams[key] !== undefined && (stepParams[key] < 0 || stepParams[key] > 10_000)) {
          throw new Error('Sequence step ' + String(index + 1) + ' has out-of-range coordinates')
        }
      }
    }
    if (step.action === 'navigate') httpUrl(stepParams.url)
    if (step.action === 'evaluate' && (stepParams.expression.trim() === ''
      || stepParams.expression.length > MAX_EVALUATION_CHARS)) {
      throw new Error('Sequence step ' + String(index + 1) + ' has an invalid JavaScript expression')
    }
    if (step.action === 'snapshot' && stepParams.maxChars !== undefined
      && stepParams.maxChars < 1) throw new Error('Sequence snapshot maxChars must be positive')
    if (['get_html', 'get_source'].includes(step.action) && stepParams.maxChars !== undefined
      && stepParams.maxChars < 1) throw new Error('Sequence content maxChars must be positive')
    return { action: step.action, method: spec.method, params: stepParams }
  })
  return { tabId, steps, interActionDelayMs }
}

function executeBrowserOperation(method, params, signal) {
  const tabId = Number.isSafeInteger(params?.tabId) ? params.tabId : undefined
  if (tabId === undefined) return executeBrowserOperationNow(method, params, signal)
  const previous = tabOperationTails.get(tabId) ?? Promise.resolve()
  const current = previous.then(() => {
    signal?.throwIfAborted()
    return executeBrowserOperationNow(method, params, signal)
  })
  const tail = current.then(() => {}, () => {})
  tabOperationTails.set(tabId, tail)
  void tail.then(() => {
    if (tabOperationTails.get(tabId) === tail) tabOperationTails.delete(tabId)
  })
  return current
}

async function executeBrowserOperationNow(method, params, signal) {
  switch (method) {
    case 'page.sequence': {
      const settings = await getBehaviorSettings()
      const sequence = normalizeSequenceCommand(params, settings.sequenceDelayMs)
      const results = []
      for (let index = 0; index < sequence.steps.length; index++) {
        const step = sequence.steps[index]
        try {
          signal?.throwIfAborted()
          if (index > 0 && sequence.interActionDelayMs > 0) {
            await delay(sequence.interActionDelayMs, signal ?? new AbortController().signal)
          }
          signal?.throwIfAborted()
          const result = await executeBrowserOperationNow(step.method, step.params, signal)
          results.push({ index: index + 1, action: step.action, result })
        } catch (error) {
          if (signal?.aborted) throw error
          return {
            ok: false,
            completedSteps: results.length,
            failedStep: index + 1,
            failedAction: step.action,
            error: error instanceof Error ? error.message : String(error),
            results,
          }
        }
      }
      return { ok: true, completedSteps: results.length, results }
    }
    case 'page.networkCapture':
      return captureNetwork(params, signal)
    case 'page.consoleCapture':
      return captureConsole(params, signal)
    case 'page.extract':
      return extractPage(params)
    case 'page.focus':
    case 'page.blur': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector)
      return withDebugger(tabId, async target => {
        const nodeId = await querySelectorNode(target, selector)
        if (method === 'page.focus') {
          await debuggerCommand(target, 'DOM.focus', { nodeId })
          const focused = await callNodeFunction(target, nodeId, 'function () { return document.activeElement === this }')
          return { tabId, selector, focused: focused === true }
        }
        const blurred = await callNodeFunction(target, nodeId, 'function () { this.blur(); return document.activeElement !== this }')
        return { tabId, selector, blurred: blurred === true }
      })
    }
    case 'page.selectOption': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector)
      const matchCount = ['value', 'label', 'index'].filter(key => params[key] !== undefined).length
      if (matchCount !== 1) throw new Error('Provide exactly one of value, label, or index')
      return withDebugger(tabId, async target => {
        const nodeId = await querySelectorNode(target, selector)
        const result = await callNodeFunction(target, nodeId, `function (value, label, index) {
          if (!(this instanceof HTMLSelectElement)) throw new Error('The selected element is not a select control')
          const options = Array.from(this.options)
          let matches
          if (index !== undefined && index !== null) {
            if (!Number.isInteger(index) || index < 0 || index >= options.length) throw new Error('Option index is out of range')
            matches = [options[index]]
          } else if (label !== undefined && label !== null) {
            matches = options.filter(option => option.label.trim() === label)
            if (matches.length !== 1) throw new Error('The option label must match exactly one option')
          } else {
            const values = Array.isArray(value) ? value : [value]
            matches = values.map(item => options.find(option => option.value === item)).filter(Boolean)
            if (matches.length !== values.length) throw new Error('One or more option values were not found')
            if (!this.multiple && values.length !== 1) throw new Error('A single-select control accepts one value')
          }
          if (this.multiple) {
            for (const option of options) option.selected = matches.includes(option)
          } else {
            this.selectedIndex = options.indexOf(matches[0])
          }
          this.dispatchEvent(new Event('input', { bubbles: true }))
          this.dispatchEvent(new Event('change', { bubbles: true }))
          return Array.from(this.selectedOptions, option => ({ value: option.value, label: option.label }))
        }`, [params.value ?? null, params.label ?? null, params.index ?? null])
        return { tabId, selector, selected: result }
      })
    }
    case 'page.uploadFiles': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector)
      const paths = params.paths
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 10
        || paths.some(path => typeof path !== 'string' || path.length > 4_096
          || !(/^[A-Za-z]:[\\/]/u.test(path) || /^\\\\/u.test(path) || /^\//u.test(path)))) {
        throw new Error('paths must contain 1 to 10 absolute file paths')
      }
      return withDebugger(tabId, async target => {
        const nodeId = await querySelectorNode(target, selector)
        const metadata = await callNodeFunction(target, nodeId, 'function () { return { tag: this.tagName, type: this.type, multiple: this.multiple === true } }')
        if (metadata?.tag !== 'INPUT' || metadata.type !== 'file') {
          throw new Error('The selected element is not a file input')
        }
        if (paths.length > 1 && metadata.multiple !== true) {
          throw new Error('The file input does not allow multiple files')
        }
        await debuggerCommand(target, 'DOM.setFileInputFiles', { nodeId, files: paths })
        const files = await callNodeFunction(target, nodeId, 'function () { return Array.from(this.files || [], file => ({ name: file.name, size: file.size, type: file.type })) }')
        return { tabId, selector, selectedCount: Array.isArray(files) ? files.length : 0, files }
      })
    }
    case 'page.fetchFile':
      return fetchFileWithTabSession(params)
    case 'page.fetchFileRetry':
      return fetchFileApprovedRetry(params)
    case 'downloads.start':
      return startDownload(params)
    case 'downloads.status':
      return getDownloadStatus(params.downloadId)
    case 'downloads.cancel':
      await chrome.downloads.cancel(params.downloadId)
      return { downloadId: params.downloadId, cancelled: true }
    case 'tabs.list':
      return { tabs: await getTabs() }
    case 'tabs.open': {
      const url = httpUrl(params.url)
      const tab = await chrome.tabs.create({ url, active: params.active !== false })
      return { tabId: tab.id, url: tab.url ?? url, title: tab.title ?? '' }
    }
    case 'tabs.activate': {
      const tabId = requireTabId(params.tabId)
      const tab = await chrome.tabs.update(tabId, { active: true })
      return { tabId, active: tab.active === true, url: tab.url ?? '' }
    }
    case 'tabs.close': {
      const tabId = requireTabId(params.tabId)
      await chrome.tabs.remove(tabId)
      return { tabId, closed: true }
    }
    case 'page.frames': {
      const tabId = requireTabId(params.tabId)
      return listFrames(tabId)
    }
    case 'page.workbookValues': {
      const tabId = requireTabId(params.tabId)
      const frameId = requireFrameId(params.frameId)
      const payload = await runInFrame(tabId, frameId, frameWorkbookValuesPayload,
        [MAX_WORKBOOK_CELLS, MAX_WORKBOOK_RESULT_CHARS], 'MAIN')
      if (!isRecord(payload)) throw new Error('The frame returned no workbook data')
      if (typeof payload.error === 'string') throw new Error(payload.error)
      return { tabId, frameId, ...payload }
    }
    case 'page.elementWatch': {
      const tabId = requireTabId(params.tabId)
      const frameId = requireFrameId(params.frameId)
      const action = params.action ?? 'read'
      if (!['start', 'stop', 'read'].includes(action)) throw new Error('elementWatch action must be start, stop, or read')
      let selector = params.selector
      let labelSelector = typeof params.labelSelector === 'string' && params.labelSelector !== ''
        ? params.labelSelector
        : null
      if (params.preset === 'excel-online') {
        // Excel for the web: watch the formula bar content, labelled by the name box address.
        selector = selector ?? '#formulaBarTextDivId_textElement'
        labelSelector = labelSelector ?? '#FormulaBar-NameBox-input'
      }
      if (action === 'start') requireCssSelector(selector, 'The watch selector')
      if (labelSelector !== null) requireCssSelector(labelSelector, 'The label selector')
      const clear = params.clear === true
      const func = action === 'start' ? frameElementWatchStartPayload
        : action === 'stop' ? frameElementWatchStopPayload
          : frameElementWatchReadPayload
      const args = action === 'start' ? [selector, labelSelector] : [clear]
      const payload = await runInFrame(tabId, frameId, func, args, 'MAIN')
      if (!isRecord(payload)) throw new Error('The frame returned no element watch result')
      if (typeof payload.error === 'string') throw new Error(payload.error)
      return { tabId, frameId, action, ...payload }
    }
    case 'page.workbookProbe': {
      const tabId = requireTabId(params.tabId)
      const frameId = requireFrameId(params.frameId)
      const payload = await runInFrame(tabId, frameId, frameWorkbookProbePayload, [], 'MAIN')
      if (!isRecord(payload)) throw new Error('The frame returned no workbook API probe')
      return { tabId, frameId, ...payload }
    }
    case 'page.workbookFile': {
      const tabId = requireTabId(params.tabId)
      const frameId = requireFrameId(params.frameId)
      // The WOPI token is read inside the app frame but only ever handled in this service
      // worker; the extension's host permissions allow the fetch without CORS. The result
      // returned to DSH contains used-range text or file bytes.
      const wopi = await runInFrame(tabId, frameId, frameWopiContextPayload, [])
      if (!isRecord(wopi)) throw new Error('The frame returned no result')
      if (typeof wopi.error === 'string') throw new Error(wopi.error)
      if (typeof wopi.wopisrc !== 'string' || typeof wopi.token !== 'string') {
        throw new Error('The frame has no WOPI context')
      }
      // Prefer the ExcelRest used-range text (small, directly readable); fall back to the
      // raw file bytes via WOPI /contents. Token variants: Bearer header, then query param.
      const baseHeaders = { 'X-Requested-With': 'XMLHttpRequest' }
      if (typeof wopi.usid === 'string' && wopi.usid !== '') baseHeaders['X-UserSessionId'] = wopi.usid
      const attempts = []
      if (typeof wopi.restUrl === 'string' && wopi.restUrl !== '') {
        const base = wopi.restUrl.replace(/\/+$/, '')
        const sheetPath = "Sheets('" + String(wopi.sheetName ?? 'Sheet1').replace(/'/g, '') + "')"
        attempts.push({ kind: 'text', url: base + '/' + sheetPath + '/UsedRange/Text', headers: { ...baseHeaders, Authorization: 'Bearer ' + wopi.token } })
        attempts.push({ kind: 'text', url: base + '/' + sheetPath + '/UsedRange/Text?access_token=' + encodeURIComponent(wopi.token), headers: baseHeaders })
      }
      attempts.push({ kind: 'file', url: wopi.wopisrc + '/contents', headers: { ...baseHeaders, Authorization: 'Bearer ' + wopi.token } })
      attempts.push({ kind: 'file', url: wopi.wopisrc + '/contents?access_token=' + encodeURIComponent(wopi.token), headers: baseHeaders })
      let lastStatus = 0
      for (const attempt of attempts) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new Error('request timed out')), 8_000)
        let response
        try {
          response = await fetch(attempt.url, {
            headers: attempt.headers,
            cache: 'no-store',
            credentials: 'include',
            signal: controller.signal,
          })
        } catch {
          response = undefined
        } finally {
          clearTimeout(timer)
        }
        if (response === undefined) continue
        lastStatus = response.status
        if (!response.ok) continue
        if (attempt.kind === 'text') {
          return { tabId, frameId, kind: 'text', text: await response.text() }
        }
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        }
        return { tabId, frameId, kind: 'file', bytes: bytes.length, base64: btoa(binary) }
      }
      throw new Error('WOPI/ExcelRest request failed with status ' + String(lastStatus))
    }
    case 'page.navigate': {
      const tabId = requireTabId(params.tabId)
      const url = httpUrl(params.url)
      const tab = await navigateTabAndWait(tabId, url, signal)
      return { tabId, url: tab.url ?? url, title: tab.title ?? '', loaded: true }
    }
    case 'page.back':
    case 'page.forward':
    case 'page.reload': {
      const tabId = requireTabId(params.tabId)
      const action = method === 'page.back' ? 'back' : method === 'page.forward' ? 'forward' : 'reload'
      const { tab, navigationObserved, navigationMethod } = await historyTabAndWait(tabId, action, signal)
      return {
        tabId,
        action,
        navigated: navigationObserved,
        via: navigationMethod,
        url: tab.url ?? '',
        title: tab.title ?? '',
        loaded: tab.status === 'complete',
      }
    }
    case 'page.wait': {
      const tabId = requireTabId(params.tabId)
      const durationMs = params.durationMs
      if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_EXPLICIT_WAIT_MS) {
        throw new Error('durationMs must be an integer between 0 and ' + String(MAX_EXPLICIT_WAIT_MS))
      }
      await delay(durationMs, signal ?? new AbortController().signal)
      return { tabId, waitedMs: durationMs }
    }
    case 'page.waitForElement': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector, 'A non-empty CSS selector')
      const state = params.state ?? 'visible'
      const timeoutMs = params.timeoutMs ?? DEFAULT_ELEMENT_WAIT_TIMEOUT_MS
      const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_ELEMENT_WAIT_POLL_INTERVAL_MS
      if (!['visible', 'hidden', 'attached', 'detached'].includes(state)) {
        throw new Error('state must be visible, hidden, attached, or detached')
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_ELEMENT_WAIT_TIMEOUT_MS) {
        throw new Error('timeoutMs must be an integer between 1 and ' + String(MAX_ELEMENT_WAIT_TIMEOUT_MS))
      }
      if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_ELEMENT_WAIT_POLL_INTERVAL_MS
        || pollIntervalMs > MAX_ELEMENT_WAIT_POLL_INTERVAL_MS) {
        throw new Error('pollIntervalMs must be an integer between ' + String(MIN_ELEMENT_WAIT_POLL_INTERVAL_MS)
          + ' and ' + String(MAX_ELEMENT_WAIT_POLL_INTERVAL_MS))
      }
      const expression = `(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        if (element === null) return { exists: false, visible: false }
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const visible = style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
          && element.getClientRects().length > 0
        return { exists: true, visible, tag: element.tagName.toLowerCase(),
          text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
          bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } }
      })()`
      const startedAt = Date.now()
      return withDebugger(tabId, async target => {
        while (true) {
          signal?.throwIfAborted()
          const response = await debuggerCommand(target, 'Runtime.evaluate', {
            expression,
            returnByValue: true,
          })
          if (response.exceptionDetails !== undefined) {
            const detail = response.exceptionDetails.exception?.description
              ?? response.exceptionDetails.text
              ?? 'The page element query failed'
            throw new Error(String(detail))
          }
          const element = response.result?.value
          if (!isRecord(element)) throw new Error('Chrome returned no element state')
          const matched = state === 'attached' ? element.exists === true
            : state === 'detached' ? element.exists !== true
              : state === 'visible' ? element.visible === true
                : element.visible !== true
          if (matched) {
            if (element.visible === true) debuggerTargetsNeedingFreshCoordinates.delete(target)
            return { tabId, selector, state, found: true, waitedMs: Date.now() - startedAt, element }
          }
          const remainingMs = timeoutMs - (Date.now() - startedAt)
          if (remainingMs <= 0) throw new Error('Timed out waiting for selector to become ' + state)
          await delay(Math.min(pollIntervalMs, remainingMs), signal ?? new AbortController().signal)
        }
      })
    }
    case 'page.waitForChange': {
      const tabId = requireTabId(params.tabId)
      const { action = 'wait', watchId, afterChange = 0, mode = 'text', attribute, expectedText } = params
      if (!['arm', 'wait', 'stop'].includes(action)) throw new Error('action must be arm, wait, or stop')
      if (watchId !== undefined && (typeof watchId !== 'string' || !/^[a-f0-9-]{36}$/u.test(watchId))) {
        throw new Error('watchId must be an ID returned by arm')
      }
      if (action === 'arm' && watchId !== undefined) throw new Error('arm does not accept watchId')
      if (action === 'stop' && watchId === undefined) throw new Error('stop requires watchId')
      if (watchId !== undefined && [params.selector, params.mode, attribute].some(value => value !== undefined)) {
        throw new Error('The watchId already identifies the selector, mode, and attribute')
      }
      if (params.afterChange !== undefined && (action !== 'wait' || watchId === undefined
        || !Number.isSafeInteger(afterChange) || afterChange < 0)) {
        throw new Error('afterChange requires an armed watch and a nonnegative integer')
      }
      if (action !== 'wait' && (expectedText !== undefined || params.timeoutMs !== undefined)) {
        throw new Error('expectedText and timeoutMs apply to wait')
      }
      const selector = watchId === undefined ? requireCssSelector(params.selector) : undefined
      const watchLifetimeMs = 600_000
      const timeoutMs = params.timeoutMs ?? watchLifetimeMs
      const maxChars = 10_000
      if (!['text', 'value', 'attribute'].includes(mode)) {
        throw new Error('mode must be text, value, or attribute')
      }
      if (mode === 'attribute') {
        if (typeof attribute !== 'string' || !/^[^\s]+$/u.test(attribute) || attribute.length > 256) {
          throw new Error('attribute must be a non-empty attribute name of at most 256 characters')
        }
      } else if (attribute !== undefined) {
        throw new Error('attribute requires attribute mode')
      }
      if (expectedText !== undefined && (typeof expectedText !== 'string' || expectedText.length > maxChars)) {
        throw new Error('expectedText must be a string of at most ' + String(maxChars) + ' characters')
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > watchLifetimeMs) {
        throw new Error('timeoutMs must be an integer between 1 and ' + String(watchLifetimeMs))
      }
      const query = Object.fromEntries(Object.entries({
        action, watchId, afterChange, selector, mode, attribute, expectedText, maxChars, watchLifetimeMs,
      }).filter(([, value]) => value !== undefined))
      if (action === 'arm' || action === 'stop') {
        if (action === 'arm') query.watchId = crypto.randomUUID()
        const result = await runInFrame(tabId, 0, elementChangePayload, [query])
        if (result?.error !== undefined) throw new Error(result.error)
        if (result === undefined) throw new Error('Chrome returned no element watch result')
        return { tabId, ...result }
      }
      const startedAt = Date.now()
      const deadline = startedAt + timeoutMs
      const waitSignal = signal ?? new AbortController().signal
      let documentId
      let previousValue
      do {
        waitSignal.throwIfAborted()
        const target = documentId === undefined ? { tabId, frameIds: [0] } : { tabId, documentIds: [documentId] }
        const [sample] = await chrome.scripting.executeScript({
          target,
          func: elementChangePayload,
          args: [query],
        })
        waitSignal.throwIfAborted()
        if (sample?.documentId === undefined || sample.result === undefined) {
          throw new Error('Chrome returned no element change sample')
        }
        documentId = sample.documentId
        const { value, error, change, missedChanges } = sample.result
        if (error !== undefined) throw new Error(error)
        const waitedMs = Date.now() - startedAt
        if (waitedMs >= timeoutMs) break
        if (change !== undefined) {
          return { tabId, watchId, changed: true, ...change, missedChanges, waitedMs }
        }
        if (watchId === undefined && value !== undefined) {
          if (previousValue === undefined) {
            previousValue = value
          } else if (value !== previousValue && (expectedText === undefined || value === expectedText)) {
            return { tabId, selector, mode, changed: true, previousValue, value, waitedMs }
          }
        }
        await delay(Math.max(0, Math.min(DEFAULT_ELEMENT_WAIT_POLL_INTERVAL_MS, deadline - Date.now())), waitSignal)
      } while (Date.now() < deadline)
      throw new Error('Timed out waiting for the selected element to change')
    }
    case 'page.elementNotes':
      return readElementNotes(params)
    case 'page.snapshot': {
      const tabId = requireTabId(params.tabId)
      const maxChars = Number.isInteger(params.maxChars)
        ? Math.max(1, Math.min(MAX_SNAPSHOT_CHARS, params.maxChars))
        : 20_000
      if (params.frameId !== undefined) {
        const frameId = requireFrameId(params.frameId)
        const payload = await runInFrame(tabId, frameId, frameSnapshotPayload, [maxChars])
        return {
          tabId,
          frameId,
          ...(isRecord(payload)
            ? payload
            : { title: '', url: '', text: '', links: [], grid: { cellCount: 0, cells: [], canvasCount: 0, gridRoleCount: 0 } }),
        }
      }
      const expression = "(() => ({title: document.title, url: location.href, text: (document.body?.innerText ?? '').slice(0, "
        + String(maxChars)
        + "), links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(link => ({text: (link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 240), url: link.href}))}))()"
      return withDebugger(tabId, async target => {
        const response = await debuggerCommand(target, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })
        if (response.exceptionDetails !== undefined) throw new Error('The page snapshot could not be read')
        return response.result?.value ?? { title: '', url: '', text: '', links: [] }
      })
    }
    case 'page.find': {
      const tabId = requireTabId(params.tabId)
      if (typeof params.query !== 'string' || params.query.trim() === ''
        || params.query.length > MAX_FIND_QUERY_CHARS) {
        throw new Error('Find query must be non-empty and at most ' + String(MAX_FIND_QUERY_CHARS) + ' characters')
      }
      const strategy = params.strategy ?? 'css'
      if (strategy !== 'css' && strategy !== 'xpath') throw new Error('Find strategy must be css or xpath')
      const limit = Number.isInteger(params.limit)
        ? Math.max(1, Math.min(MAX_FIND_RESULTS, params.limit))
        : 20
      const queryLiteral = JSON.stringify(params.query)
      const expression = `(() => {
        const query = ${queryLiteral}
        let matches
        if (${JSON.stringify(strategy)} === 'xpath') {
          const result = document.evaluate(query, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
          matches = []
          for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i)
            if (node instanceof Element) matches.push(node)
          }
        } else {
          matches = Array.from(document.querySelectorAll(query))
        }
        const candidates = matches.slice(0, ${String(limit)}).map((element, index) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          const visible = style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
            && element.getClientRects().length > 0
          const inViewport = visible && rect.right > 0 && rect.bottom > 0
            && rect.left < window.innerWidth && rect.top < window.innerHeight
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const hit = inViewport ? document.elementFromPoint(x, y) : null
          const href = element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement
            ? element.href : element.getAttribute('href')
          const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim()
          return {
            index,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            text: text.slice(0, ${String(MAX_FIND_TEXT_CHARS)}),
            href: typeof href === 'string' ? href.slice(0, ${String(MAX_FIND_HREF_CHARS)}) : null,
            ariaLabel: element.getAttribute('aria-label'),
            visible,
            inViewport,
            enabled: element.disabled !== true && !element.matches(':disabled')
              && element.getAttribute('aria-disabled')?.toLowerCase() !== 'true',
            bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            center: { x, y },
            centerHit: hit === element || (hit !== null && element.contains(hit)),
          }
        })
        return { strategy: ${JSON.stringify(strategy)}, matchCount: matches.length,
          truncated: matches.length > candidates.length, candidates }
      })()`
      return withDebugger(tabId, async target => {
        const response = await debuggerCommand(target, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
        })
        if (response.exceptionDetails !== undefined) {
          const detail = response.exceptionDetails.exception?.description
            ?? response.exceptionDetails.text
            ?? 'The page query could not be evaluated'
          throw new Error(String(detail))
        }
        if (!isRecord(response.result?.value)) throw new Error('Chrome returned no element matches')
        if (Array.isArray(response.result.value.candidates) && response.result.value.candidates.length > 0) {
          debuggerTargetsNeedingFreshCoordinates.delete(target)
        }
        return { tabId, ...response.result.value }
      })
    }
    case 'page.html': {
      const tabId = requireTabId(params.tabId)
      const maxChars = Number.isInteger(params.maxChars)
        ? Math.max(1, Math.min(MAX_HTML_CHARS, params.maxChars))
        : 50_000
      if (params.selector !== undefined) requireCssSelector(params.selector)
      if (params.frameId !== undefined) {
        const frameId = requireFrameId(params.frameId)
        const payload = await runInFrame(tabId, frameId, frameHtmlPayload, [params.selector ?? null, maxChars])
        return { tabId, frameId, ...(isRecord(payload) ? payload : {}), source: 'live-dom' }
      }
      return withDebugger(tabId, async target => {
        const nodeId = params.selector === undefined
          ? await rootNodeId(target)
          : await querySelectorNode(target, params.selector)
        const result = await debuggerCommand(target, 'DOM.getOuterHTML', { nodeId })
        if (typeof result.outerHTML !== 'string') throw new Error('Chrome returned no HTML')
        return {
          tabId,
          html: result.outerHTML.slice(0, maxChars),
          totalChars: result.outerHTML.length,
          truncated: result.outerHTML.length > maxChars,
          source: 'live-dom',
        }
      })
    }
    case 'page.evaluate': {
      const tabId = requireTabId(params.tabId)
      if (typeof params.expression !== 'string' || params.expression.trim() === ''
        || params.expression.length > MAX_EVALUATION_CHARS) {
        throw new Error('JavaScript expression must be non-empty and at most ' + String(MAX_EVALUATION_CHARS) + ' characters')
      }
      const timeoutMs = Number.isInteger(params.timeoutMs)
        ? Math.max(1, Math.min(MAX_EVALUATION_TIMEOUT_MS, params.timeoutMs))
        : DEFAULT_EVALUATION_TIMEOUT_MS
      if (params.frameId !== undefined) {
        const frameId = requireFrameId(params.frameId)
        const payload = await evaluateInFrame(tabId, frameId, params.expression)
        return { tabId, frameId, ...payload }
      }
      return withDebugger(tabId, async target => {
        const response = await debuggerCommand(target, 'Runtime.evaluate', {
          expression: params.expression,
          returnByValue: true,
          awaitPromise: true,
          timeout: timeoutMs,
        })
        if (response.exceptionDetails !== undefined) {
          const detail = response.exceptionDetails.exception?.description
            ?? response.exceptionDetails.text
            ?? 'JavaScript evaluation failed'
          throw new Error(String(detail))
        }
        const remote = response.result ?? {}
        if (remote.value !== undefined) {
          const serialized = JSON.stringify(remote.value)
          if (serialized.length > MAX_EVALUATION_RESULT_CHARS) {
            return {
              tabId,
              type: remote.type ?? 'object',
              valueText: serialized.slice(0, MAX_EVALUATION_RESULT_CHARS),
              truncated: true,
            }
          }
          return { tabId, type: remote.type ?? typeof remote.value, value: remote.value }
        }
        if (remote.unserializableValue !== undefined) {
          return { tabId, type: remote.type ?? 'undefined', value: remote.unserializableValue }
        }
        if (remote.description !== undefined) {
          return { tabId, type: remote.type ?? 'object', description: remote.description }
        }
        return { tabId, type: remote.type ?? 'undefined', undefined: true }
      })
    }
    case 'page.source': {
      const tabId = requireTabId(params.tabId)
      const maxChars = Number.isInteger(params.maxChars)
        ? Math.max(1, Math.min(MAX_SOURCE_CHARS, params.maxChars))
        : 50_000
      return withDebugger(tabId, async target => {
        await debuggerCommand(target, 'Page.enable').catch(() => {})
        const tree = await debuggerCommand(target, 'Page.getResourceTree')
        const frame = tree.frameTree?.frame
        if (!isRecord(frame) || typeof frame.id !== 'string' || typeof frame.url !== 'string') {
          throw new Error('The page resource tree is unavailable')
        }
        let content
        try {
          content = await debuggerCommand(target, 'Page.getResourceContent', { frameId: frame.id, url: frame.url })
        } catch {
          throw new Error('Chrome no longer retains the original main-document content for this tab')
        }
        if (!isRecord(content) || typeof content.content !== 'string') {
          throw new Error('Chrome returned no original source content')
        }
        const text = content.base64Encoded === true ? decodeBase64Utf8(content.content) : content.content
        return {
          tabId,
          url: frame.url,
          source: text.slice(0, maxChars),
          totalChars: text.length,
          truncated: text.length > maxChars,
          base64Encoded: content.base64Encoded === true,
        }
      })
    }
    case 'page.scroll': {
      const tabId = requireTabId(params.tabId)
      const hasSelector = params.selector !== undefined
      const hasDelta = params.deltaX !== undefined || params.deltaY !== undefined
      if (hasSelector === hasDelta) throw new Error('Provide a selector or one or both scroll deltas')
      if (params.selector !== undefined) requireCssSelector(params.selector)
      const deltaX = params.deltaX ?? 0
      const deltaY = params.deltaY ?? 0
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)
        || Math.abs(deltaX) > 10_000 || Math.abs(deltaY) > 10_000) {
        throw new Error('Scroll deltas must be between -10000 and 10000')
      }
      return withDebugger(tabId, async target => {
        if (hasSelector) {
          const nodeId = await querySelectorNode(target, params.selector)
          const info = await callNodeFunction(target, nodeId, SCROLL_TO_VIEW_FUNCTION)
          if (!isRecord(info) || info.visible !== true) {
            throw new Error('The selected element could not be brought into the viewport')
          }
          debuggerTargetsNeedingFreshCoordinates.delete(target)
          return {
            tabId, scrolled: true, selector: params.selector,
            x: (info.left + info.right) / 2,
            y: (info.top + info.bottom) / 2,
            viewportWidth: info.width,
            viewportHeight: info.height,
          }
        }
        const response = await debuggerCommand(target, 'Runtime.evaluate', {
          expression: '(() => { window.scrollBy({ left: ' + String(deltaX)
            + ', top: ' + String(deltaY)
            + ', behavior: "instant" }); return { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight } })()',
          returnByValue: true,
        })
        const position = response.result?.value
        if (!isRecord(position)) throw new Error('The page could not be scrolled')
        return { tabId, scrolled: true, ...position }
      })
    }
    case 'page.click': {
      const tabId = requireTabId(params.tabId)
      const hasSelector = params.selector !== undefined
      const hasCoords = Number.isFinite(params.x) && Number.isFinite(params.y)
      const animate = true
      if (hasSelector) requireCssSelector(params.selector)
      if (!hasSelector && !hasCoords) throw new Error('Provide a CSS selector or x and y click coordinates')
      if (hasCoords && (params.x < 0 || params.y < 0 || params.x > 10000 || params.y > 10000)) {
        throw new Error('Click coordinates must be between 0 and 10000')
      }
      return withDebugger(tabId, async target => {
        let x = params.x
        let y = params.y
        if (hasSelector) {
          const nodeId = await querySelectorNode(target, params.selector)
          const scrollInfo = await callNodeFunction(target, nodeId, SCROLL_TO_VIEW_FUNCTION)
          if (!isRecord(scrollInfo) || scrollInfo.visible !== true) {
            throw new Error('The selected element could not be brought into the viewport')
          }
          const info = await callNodeFunction(target, nodeId, CLICK_INFO_FUNCTION)
          if (!isRecord(info)) throw new Error('The selected element could not be inspected')
          if (info.disabled === true) throw new Error('The selected element is disabled')
          if (info.pointerEvents === 'none') throw new Error('The selected element does not receive pointer events')
          const box = await debuggerCommand(target, 'DOM.getBoxModel', { nodeId })
          const quad = box?.model?.content ?? box?.model?.border
          if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(Number.isFinite)) {
            throw new Error('The selected element has no clickable area')
          }
          x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
          y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
          const viewportWidth = Number.isFinite(info.viewportWidth) ? info.viewportWidth : scrollInfo.width
          const viewportHeight = Number.isFinite(info.viewportHeight) ? info.viewportHeight : scrollInfo.height
          if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
            throw new Error('The selected element is outside the viewport after scrolling')
          }
          const hitTarget = await callNodeFunction(target, nodeId, CLICK_HIT_TEST_FUNCTION, [x, y])
          if (hitTarget !== true) throw new Error('The selected element is covered at its click point')
          debuggerTargetsNeedingFreshCoordinates.delete(target)
        } else {
          if (debuggerTargetsNeedingFreshCoordinates.has(target)) {
            throw new Error('Chrome changed the page viewport when browser control connected. Take a fresh screenshot or use a CSS selector, then retry.')
          }
          const viewport = await viewportSize(target)
          if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
            throw new Error('Click coordinates are outside the viewport. Scroll the target into view and use current viewport coordinates.')
          }
        }
        if (animate) await visualCursorMove(tabId, x, y, true)
        await debuggerCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y, button: 'none', buttons: 0, modifiers: 0,
        })
        await debuggerCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', clickCount: 1,
        })
        await debuggerCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
        })
        return { tabId, clicked: true, ...(hasSelector ? { selector: params.selector } : {}), x, y }
      })
    }
    case 'page.drag': {
      const tabId = requireTabId(params.tabId)
      const traceId = dragTraceByTab.get(tabId)
      const hasSelectors = params.fromSelector !== undefined || params.toSelector !== undefined
      const hasCoordinates = params.fromX !== undefined || params.fromY !== undefined
        || params.toX !== undefined || params.toY !== undefined
      if (hasSelectors === hasCoordinates) {
        throw new Error('Provide both drag selectors or all four drag coordinates')
      }
      const settings = await getBehaviorSettings()
      let durationMs = params.durationMs ?? settings.dragDurationMs
      if (!Number.isSafeInteger(durationMs) || durationMs < MIN_DRAG_DURATION_MS || durationMs > MAX_DRAG_DURATION_MS) {
        throw new Error('durationMs must be an integer between 100 and 2000')
      }
      const animate = true
      return withDebugger(tabId, async target => {
        if (traceId !== undefined) logDragTrace(traceId, 'drag-geometry-start')
        let from
        let to
        if (hasSelectors) {
          if (typeof params.fromSelector !== 'string' || typeof params.toSelector !== 'string') {
            throw new Error('Provide both fromSelector and toSelector')
          }
          requireCssSelector(params.fromSelector, 'The source CSS selector')
          requireCssSelector(params.toSelector, 'The destination CSS selector')
          from = await resolveElementPoint(target, { selector: params.fromSelector })
          to = await resolveElementPoint(target, { selector: params.toSelector })
          const fromViewport = await viewportSize(target)
          if (from.x >= fromViewport.width || from.y >= fromViewport.height) {
            throw new Error('The drag source moved out of view while bringing the destination into view')
          }
          const fromNodeId = await querySelectorNode(target, params.fromSelector)
          const fromHit = await callNodeFunction(target, fromNodeId, CLICK_HIT_TEST_FUNCTION, [from.x, from.y])
          if (fromHit !== true) throw new Error('The drag source is no longer visible at its center point')
          debuggerTargetsNeedingFreshCoordinates.delete(target)
        } else {
          if (debuggerTargetsNeedingFreshCoordinates.has(target)) {
            throw new Error('Chrome changed the page viewport when browser control connected. Take a fresh screenshot or use CSS selectors, then retry.')
          }
          const values = [params.fromX, params.fromY, params.toX, params.toY]
          if (!values.every(Number.isFinite) || values.some(value => value < 0 || value > 10_000)) {
            throw new Error('All drag coordinates must be between 0 and 10000')
          }
          const viewport = await viewportSize(target)
          if (params.fromX >= viewport.width || params.fromY >= viewport.height
            || params.toX >= viewport.width || params.toY >= viewport.height) {
            throw new Error('Drag coordinates must be within the current viewport')
          }
          from = { x: params.fromX, y: params.fromY }
          to = { x: params.toX, y: params.toY }
        }
        const distance = Math.hypot(to.x - from.x, to.y - from.y)
        if (distance < 1) throw new Error('Drag start and end points must be different')
        const steps = Math.max(8, Math.min(40, Math.round(distance / 20)))
        const stepDelayMs = durationMs / steps
        let current = from
        let pressed = false
        try {
          if (animate) {
            if (traceId !== undefined) logDragTrace(traceId, 'cursor-origin-start')
            await visualCursorMove(tabId, from.x, from.y, true)
            if (traceId !== undefined) logDragTrace(traceId, 'cursor-origin-finished')
          }
          await debuggerCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0, modifiers: 0,
          })
          await debuggerCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1,
            clickCount: 1, modifiers: 0,
          })
          pressed = true
          if (traceId !== undefined) logDragTrace(traceId, 'drag-loop-start', { method: String(steps) + '-steps' })
          const overlayMove = animate
            ? visualCursorMove(tabId, to.x, to.y, true, durationMs).then(() => {
              if (traceId !== undefined) logDragTrace(traceId, 'cursor-target-finished')
            })
            : Promise.resolve()
          if (animate && traceId !== undefined) logDragTrace(traceId, 'cursor-target-start')
          for (let index = 1; index <= steps; index++) {
            signal?.throwIfAborted()
            await delay(stepDelayMs, signal ?? new AbortController().signal)
            const progress = index / steps
            const eased = progress * progress * (3 - 2 * progress)
            current = {
              x: from.x + (to.x - from.x) * eased,
              y: from.y + (to.y - from.y) * eased,
            }
            await debuggerCommand(target, 'Input.dispatchMouseEvent', {
              type: 'mouseMoved', x: current.x, y: current.y,
              button: 'left', buttons: 1, modifiers: 0,
            })
          }
          await debuggerCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0,
            clickCount: 1, modifiers: 0,
          })
          pressed = false
          if (traceId !== undefined) logDragTrace(traceId, 'mouse-release-finished')
          await overlayMove
          if (traceId !== undefined) logDragTrace(traceId, 'drag-complete')
          return {
            tabId, dragged: true, from, to, durationMs, steps, animated: animate,
          }
        } finally {
          if (pressed) {
            await debuggerCommand(target, 'Input.dispatchMouseEvent', {
              type: 'mouseReleased', x: current.x, y: current.y, button: 'left', buttons: 0,
              clickCount: 1, modifiers: 0,
            }).catch(() => {})
          }
        }
      })
    }
    case 'page.type': {
      throw new Error('Bulk text insertion (page.type) is not allowed; use page.typeHuman / dsh_browser_type_human so text is entered per keystroke')
    }
    case 'page.typeHuman': {
      const tabId = requireTabId(params.tabId)
      if (typeof params.text !== 'string' || params.text.length === 0 || params.text.length > MAX_HUMAN_TEXT_CHARS) {
        throw new Error('Text must be a non-empty string of at most ' + String(MAX_HUMAN_TEXT_CHARS) + ' characters')
      }
      const settings = await getBehaviorSettings()
      const delayMs = Number.isInteger(params.delayMs)
        ? Math.max(0, Math.min(MAX_TYPE_DELAY_MS, params.delayMs))
        : settings.baseFlightDelayMs
      return withDebugger(tabId, async target => {
        if (params.selector !== undefined) {
          requireCssSelector(params.selector)
          const nodeId = await querySelectorNode(target, params.selector)
          await debuggerCommand(target, 'DOM.focus', { nodeId })
        }
        let prevChar = ''
        for (const char of params.text) {
          signal?.throwIfAborted()
          await typeCharacter(target, char, prevChar, delayMs, settings, signal)
          prevChar = char
        }
        return { tabId, typedCharacters: params.text.length, human: true, delayMs }
      })
    }
    case 'page.mouseMove': {
      const tabId = requireTabId(params.tabId)
      const hasSelector = params.selector !== undefined
      const hasCoordinates = params.x !== undefined || params.y !== undefined
      if (hasSelector === hasCoordinates) throw new Error('Provide a CSS selector or both x and y mouse coordinates')
      if (hasSelector) requireCssSelector(params.selector)
      if (hasCoordinates && (!Number.isFinite(params.x) || !Number.isFinite(params.y)
        || params.x < 0 || params.y < 0 || params.x > 10000 || params.y > 10000)) {
        throw new Error('Mouse coordinates must be between 0 and 10000')
      }
      const animate = true
      return withDebugger(tabId, async target => {
        let x = params.x
        let y = params.y
        if (hasSelector) {
          const point = await resolveElementPoint(target, { selector: params.selector })
          x = point.x
          y = point.y
          debuggerTargetsNeedingFreshCoordinates.delete(target)
        } else if (debuggerTargetsNeedingFreshCoordinates.has(target)) {
          throw new Error('Chrome changed the page viewport when browser control connected. Take a fresh screenshot or use a CSS selector, then retry.')
        }
        const viewport = await viewportSize(target)
        if (x >= viewport.width || y >= viewport.height) {
          throw new Error('Mouse coordinates are outside the viewport. Scroll the target into view and use current viewport coordinates.')
        }
        if (animate) await visualCursorMove(tabId, x, y, true)
        await debuggerCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y, button: 'none', buttons: 0, modifiers: 0,
        })
        return { tabId, moved: true, ...(hasSelector ? { selector: params.selector } : {}), x, y, animated: animate }
      })
    }
    case 'page.fill': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector, 'A non-empty CSS selector')
      if (typeof params.text !== 'string' || params.text.length > MAX_HUMAN_TEXT_CHARS) {
        throw new Error('Text must be a string of at most ' + String(MAX_HUMAN_TEXT_CHARS) + ' characters')
      }
      if (/[\r\n\t]/u.test(params.text)) {
        throw new Error('Fill text cannot contain tabs or line breaks; use dsh_browser_type_human when those keystrokes are intended')
      }
      const settings = await getBehaviorSettings()
      const delayMs = Number.isInteger(params.delayMs)
        ? Math.max(0, Math.min(MAX_TYPE_DELAY_MS, params.delayMs))
        : settings.baseFlightDelayMs
      return withDebugger(tabId, async target => {
        const nodeId = await querySelectorNode(target, selector)
        // Focus the field, validate it is editable, and select its current text.
        const prepared = await callNodeFunction(target, nodeId, FILL_PREPARE_FUNCTION)
        if (isRecord(prepared) && prepared.selectAllByKey === true) {
          // Number inputs ignore el.select(); select all with Ctrl+A instead.
          // pressKey dispatches Control itself so the input tracker stays balanced.
          await pressKey(target, { key: 'a', code: 'KeyA', virtualKey: 65, modifiers: 2 })
        }
        // Type the replacement character by character (the selection is replaced
        // as we type), because some fields reject paste-style bulk insertion.
        let prevChar = ''
        for (const char of params.text) {
          signal?.throwIfAborted()
          await typeCharacter(target, char, prevChar, delayMs, settings, signal)
          prevChar = char
        }
        await callNodeFunction(target, nodeId, FILL_CHANGE_FUNCTION)
        return { tabId, filled: true, selector, characters: params.text.length, human: true }
      })
    }
    case 'page.submit': {
      const tabId = requireTabId(params.tabId)
      const selector = requireCssSelector(params.selector, 'A non-empty CSS selector')
      if (params.submitter !== undefined) requireCssSelector(params.submitter, 'The submitter selector')
      return withDebugger(tabId, async target => {
        const objectId = await querySelectorObjectId(target, selector)
        const args = params.submitter === undefined
          ? []
          : [{ objectId: await querySelectorObjectId(target, params.submitter) }]
        const response = await debuggerCommand(target, 'Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: SUBMIT_FUNCTION,
          arguments: args,
          returnByValue: true,
          awaitPromise: true,
        })
        if (response.exceptionDetails !== undefined) {
          throw new Error(String(response.exceptionDetails.exception?.description
            ?? response.exceptionDetails.text ?? 'The form could not be submitted'))
        }
        const value = isRecord(response.result?.value) ? response.result.value : {}
        return {
          tabId,
          attempted: true,
          valid: value.valid === true,
          validationSkipped: value.validationSkipped === true,
          // requestSubmit() was called; it only submits when the form is valid.
          selector,
        }
      })
    }
    case 'page.keypress': {
      const tabId = requireTabId(params.tabId)
      const key = KEYS[params.key] ?? parseKeyChord(params.key)
      if (key === undefined) {
        throw new Error('The requested key is not supported; use a key name (Enter, Tab, Escape, arrows, Home, End, PageUp, PageDown, Space, letters, digits) or a chord like Ctrl+L, Control+Shift+ArrowRight. Window/tab-closing chords (Alt+F4, Ctrl+W, Cmd+W, Ctrl+Shift+Q) are refused')
      }
      return withDebugger(tabId, async target => {
        await pressKey(target, key)
        return { tabId, key: params.key, pressed: true, modifiers: key.modifiers ?? 0 }
      })
    }
    case 'page.screenshot': {
      const tabId = requireTabId(params.tabId)
      // Hide the cosmetic cursor overlay so it never pollutes captures.
      await sendOverlayControl(tabId, 'DSH_CURSOR_HIDE')
      try {
        return await withDebugger(tabId, async target => {
          const response = await debuggerCommand(target, 'Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          })
          if (typeof response.data !== 'string') throw new Error('Chrome returned no screenshot data')
          debuggerTargetsNeedingFreshCoordinates.delete(target)
          return { tabId, data: response.data, mimeType: 'image/png' }
        })
      } finally {
        await sendOverlayControl(tabId, 'DSH_CURSOR_SHOW')
      }
    }
    default:
      throw new Error('Unsupported Chrome browser operation: ' + method)
  }
}

async function getTabs() {
  const tabs = await chrome.tabs.query({})
  return tabs
    .filter(tab => Number.isInteger(tab.id))
    .map(tab => ({
      tabId: tab.id,
      windowId: tab.windowId,
      active: tab.active === true,
      title: typeof tab.title === 'string' ? tab.title : '',
      url: typeof tab.url === 'string' ? tab.url : '',
    }))
}

function requireTabId(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('A valid Chrome tabId is required')
  return value
}

function httpUrl(value) {
  if (typeof value !== 'string') throw new Error('A URL is required')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('The URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS pages can be opened')
  }
  return url.href
}

function navigateTabAndWait(tabId, url, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let sawLoading = false
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error, tab) => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve(tab)
    }
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return
      if (changeInfo.status === 'loading') sawLoading = true
      if (changeInfo.status === 'complete' && sawLoading) finish(undefined, tab)
    }
    const onAbort = () => finish(signal.reason ?? new Error('Navigation cancelled'))
    const timer = setTimeout(() => finish(new Error('Navigation did not finish before timeout')), NAVIGATION_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(onUpdated)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    chrome.tabs.update(tabId, { url }).then(tab => {
      // Same-URL updates and fast navigations may already be complete by the
      // time tabs.update resolves, before the loading/complete events are seen.
      if (tab?.status === 'complete' && tab.url === url) finish(undefined, tab)
    }, error => finish(error))
  })
}

function historyTabAndWait(tabId, action, signal) {
  signal?.throwIfAborted()
  return chrome.tabs.get(tabId).then(before => new Promise((resolve, reject) => {
    let sawLoading = false
    let navigationObserved = false
    let navigationMethod = 'chrome-tabs'
    let settled = false
    let settleTimer
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(settleTimer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error, tab) => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve({ tab, navigationObserved, navigationMethod })
    }
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return
      if (changeInfo.status === 'loading') {
        sawLoading = true
        navigationObserved = true
      }
      if (changeInfo.url !== undefined && tab.url !== before.url) navigationObserved = true
      if (changeInfo.status === 'complete' && sawLoading) finish(undefined, tab)
      else if (!sawLoading && changeInfo.url !== undefined && tab.url !== before.url
        && tab.status === 'complete') finish(undefined, tab)
    }
    const onAbort = () => finish(signal.reason ?? new Error('Navigation cancelled'))
    const timer = setTimeout(() => finish(new Error('Tab navigation did not finish before timeout')), NAVIGATION_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(onUpdated)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    let operation
    try {
      operation = action === 'back' ? chrome.tabs.goBack(tabId)
        : action === 'forward' ? chrome.tabs.goForward(tabId)
          : chrome.tabs.reload(tabId)
    } catch (error) {
      finish(error)
      return
    }
    Promise.resolve(operation).catch(async error => {
      if (action === 'reload') throw error
      try {
        const historyResult = await navigateHistoryViaDebugger(tabId, action)
        navigationObserved = true
        navigationMethod = 'cdp-history'
        return historyResult
      } catch (fallbackError) {
        throw new Error(fallbackError instanceof Error ? fallbackError.message : String(error))
      }
    }).then(() => {
      if (settled) return
      return chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete' && tab.url !== before.url) {
          navigationObserved = true
          finish(undefined, tab)
          return
        }
        // Same-document history steps may not emit a loading event or change the URL.
        settleTimer = setTimeout(() => {
          chrome.tabs.get(tabId).then(current => {
            if (current.status === 'complete') finish(undefined, current)
          }, error => finish(error))
        }, action === 'reload' ? 1_000 : 400)
      }, error => finish(error))
    }, error => finish(error))
  }))
}

async function navigateHistoryViaDebugger(tabId, action) {
  return withDebugger(tabId, async target => {
    await debuggerCommand(target, 'Page.enable').catch(() => {})
    const history = await debuggerCommand(target, 'Page.getNavigationHistory')
    const index = Number.isInteger(history.currentIndex) ? history.currentIndex : -1
    const targetIndex = action === 'back' ? index - 1 : index + 1
    const entry = Array.isArray(history.entries) ? history.entries[targetIndex] : undefined
    if (!Number.isInteger(entry?.id)) {
      throw new Error(action === 'back'
        ? 'No previous page exists in the tab navigation history'
        : 'No next page exists in the tab navigation history')
    }
    await debuggerCommand(target, 'Page.navigateToHistoryEntry', { entryId: entry.id })
    return { targetUrl: entry.url, targetTitle: entry.title }
  })
}

async function withDebugger(tabIdValue, operation) {
  const tabId = requireTabId(tabIdValue)
  const traceId = dragTraceByTab.get(tabId)
  const existing = activeDebuggerTargets.get(tabId)
  if (existing !== undefined) {
    if (traceId !== undefined) logDragTrace(traceId, 'debugger-reuse')
    return operation(existing)
  }
  const target = { tabId }
  debuggerTargetsNeedingFreshCoordinates.add(target)
  const attachStartedAt = performance.now()
  if (traceId !== undefined) logDragTrace(traceId, 'debugger-attach-start')
  await chrome.debugger.attach(target, '1.3')
  if (traceId !== undefined) logDragTrace(traceId, 'debugger-attach-finished', { elapsedMs: Math.round(performance.now() - attachStartedAt) })
  activeDebuggerTargets.set(tabId, target)
  try {
    await waitForStableViewport(target)
  } catch (error) {
    if (activeDebuggerTargets.get(tabId) === target) activeDebuggerTargets.delete(tabId)
    await chrome.debugger.detach(target).catch(() => {})
    throw error
  }
  return operation(target)
}

async function detachAllDebuggerTargets() {
  const targets = [...activeDebuggerTargets.values()]
  activeDebuggerTargets.clear()
  await Promise.all(targets.map(target => chrome.debugger.detach(target).catch(() => {})))
}

/** Validate a frameId supplied by the caller (webNavigation/scripting integer frame id). */
function requireFrameId(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('A valid frameId from page.frames is required')
  }
  return value
}

/** List every frame of a tab, including cross-origin frames, via an all-frames script probe. */
async function listFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    injectImmediately: true,
    func: () => ({
      url: location.href,
      origin: location.origin,
      title: document.title,
      isMainFrame: window === window.parent,
    }),
  })
  const frames = results.map(result => ({
    frameId: result.frameId,
    isMainFrame: result.result?.isMainFrame === true,
    url: typeof result.result?.url === 'string' ? result.result.url : '',
    origin: typeof result.result?.origin === 'string' ? result.result.origin : '',
    title: typeof result.result?.title === 'string' ? result.result.title : '',
  }))
  return { tabId, frames }
}

/** Run one self-contained function inside a single frame, including cross-origin frames. */
async function runInFrame(tabId, frameId, func, args, world = 'ISOLATED') {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world,
    func,
    args,
  })
  const first = results[0]
  if (first === undefined) throw new Error('The frame returned no result')
  return first.result
}

/** Sample an element or manage its change history in Chrome's isolated world. */
function elementChangePayload(query) {
  const { action, watchId, selector, mode, attribute, maxChars, watchLifetimeMs } = query

  function readValue() {
    let matches
    try {
      matches = document.querySelectorAll(selector)
    } catch {
      return { error: 'The CSS selector is invalid' }
    }
    if (matches.length === 0) return {}
    if (matches.length !== 1) return { error: 'The CSS selector matched more than one element' }
    const element = matches[0]
    let value
    if (mode === 'attribute') {
      value = element.getAttribute(attribute)
    } else if (mode === 'value') {
      if (typeof element.value !== 'string') return { error: 'The selected element has no string value' }
      value = element.value
    } else {
      value = (element.textContent ?? '').trim()
    }
    if (value !== null && value.length > maxChars) {
      return { error: 'The selected element value exceeds ' + String(maxChars) + ' characters' }
    }
    return { value }
  }

  if (watchId === undefined) return readValue()
  const watches = globalThis.__dshElementChangeWatches ??= new Map()
  const existing = watches.get(watchId)
  if (existing !== undefined && existing.expiresAt <= Date.now()) existing.stop()
  const watch = watches.get(watchId)
  if (action === 'stop') {
    watch?.stop()
    return { watchId, stopped: watch !== undefined }
  }
  if (action === 'wait') {
    if (watch === undefined) return { error: 'The element watch expired, was stopped, or its document changed. Arm a new watch.' }
    watch.expiresAt = Date.now() + watchLifetimeMs
    watch.record()
    const { afterChange, expectedText } = query
    const change = watch.history.find(entry => entry.changeNumber > afterChange
      && (expectedText === undefined || entry.value === expectedText))
    const oldestChange = watch.history[0]?.changeNumber ?? 1
    if (change !== undefined) return { change, missedChanges: Math.max(0, oldestChange - afterChange - 1) }
    return { error: watch.error }
  }

  const initial = readValue()
  if (initial.error !== undefined) return initial
  for (const active of watches.values()) {
    if (active.expiresAt <= Date.now()) active.stop()
  }
  if (watches.size >= 8) return { error: 'This page already has 8 armed element watches. Stop one before arming another.' }

  let previousValue = initial.value
  let changeNumber = 0
  const history = []
  const entry = { history, expiresAt: Date.now() + watchLifetimeMs }
  function record() {
    if (entry.expiresAt <= Date.now()) {
      entry.stop()
      return
    }
    const { value, error } = readValue()
    entry.error = error
    if (value === undefined || value === previousValue) return
    if (previousValue !== undefined) {
      history.push({ changeNumber: ++changeNumber, previousValue, value, observedAt: Date.now() })
      if (history.length > 30) history.shift()
    }
    previousValue = value
  }
  const observer = new MutationObserver(record)
  observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
  document.addEventListener('input', record, true)
  document.addEventListener('change', record, true)
  const timer = setInterval(record, 200)
  entry.record = record
  entry.stop = () => {
    observer.disconnect()
    document.removeEventListener('input', record, true)
    document.removeEventListener('change', record, true)
    clearInterval(timer)
    watches.delete(watchId)
  }
  watches.set(watchId, entry)
  return { watchId, armed: true, initialValue: initial.value, historyLimit: 30, idleTimeoutMs: watchLifetimeMs }
}

function noteDraftKey(tabId) {
  return 'dshElementNoteDraft:' + tabId
}

function noteViewKey(tabId) {
  return 'dshElementNoteView:' + tabId
}

async function elementNoteAddress(rawUrl) {
  let url
  try { url = new URL(rawUrl) } catch { return undefined }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  url.username = ''
  url.password = ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href))
  const pageKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return {
    pageKey,
    site: url.host,
    pageUrl: url.origin + url.pathname,
    originalUrl: url.href,
    canOpen: !url.search && !url.hash,
  }
}

function noteEntries(page) {
  return Array.isArray(page) ? page : page?.notes ?? []
}

function collectElementNotes(stored, address, scope = 'domain') {
  const pages = Object.entries(stored).filter(([key, page]) => {
    if (address === undefined) return true
    return key === address.pageKey || (scope === 'domain' && page.site === address.site)
  })
  pages.sort(([aKey, a], [bKey, b]) => {
    const aCurrent = aKey === address?.pageKey
    const bCurrent = bKey === address?.pageKey
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return (a.pageUrl ?? '').localeCompare(b.pageUrl ?? '') || aKey.localeCompare(bKey)
  })
  return pages.flatMap(([pageKey, page]) => {
    const onCurrentPage = pageKey === address?.pageKey
    const meta = onCurrentPage ? address : page
    return noteEntries(page).map(({ xpath, note }) => ({
      pageKey, xpath, note, pageUrl: meta.pageUrl ?? null, canOpen: meta.canOpen === true, onCurrentPage,
    }))
  })
}

function collectMasterElementNotes(stored) {
  return collectElementNotes(stored).map(entry => {
    const page = stored[entry.pageKey]
    return { ...entry, site: page.site ?? null, originalUrl: page.originalUrl ?? null }
  })
}

async function readNoteStore() {
  await ensureTrustedLocalStorage()
  const stored = (await chrome.storage.local.get(ELEMENT_NOTES_KEY))[ELEMENT_NOTES_KEY]
  return isRecord(stored) ? stored : {}
}

async function readElementNotes(params) {
  const offset = params.offset ?? 0
  const limit = params.limit ?? 10
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be an integer between 1 and 20')
  const scope = params.scope === undefined ? 'domain' : params.scope
  if (!['domain', 'page', 'all'].includes(scope)) throw new Error('scope must be domain, page, or all')
  let tabId
  let all
  if (scope === 'all') {
    all = collectElementNotes(await readNoteStore())
  } else {
    tabId = requireTabId(params.tabId)
    const tab = await chrome.tabs.get(tabId)
    const address = await elementNoteAddress(tab.url)
    if (address === undefined) throw new Error('Element notes are available on HTTP and HTTPS pages')
    all = collectElementNotes(await readNoteStoreForAddress(address), address, scope)
  }
  const notes = all.slice(offset, offset + limit)
  const result = { scope, total: all.length, notes, notesHtml: formatElementNotes(notes) }
  if (tabId !== undefined) result.tabId = tabId
  if (offset + notes.length < all.length) result.nextOffset = offset + notes.length
  return result
}

function formatElementNotes(notes) {
  const escapeComment = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replace(/-{2,}/g, hyphens => '&#45;'.repeat(hyphens.length))
  return [
    '<!--- #-DSH-Chrome-Controller-Notes-# --->',
    ...notes.map(({ xpath, note }) => '<!--- ' + escapeComment(xpath) + ' = ' + escapeComment(note) + ' --->'),
    '<!--- ##-DSH-Chrome-Controller-Notes-## --->',
  ].join('\n')
}

let noteWriteTail = Promise.resolve()

function writeNoteStore(mutate) {
  const write = noteWriteTail.then(async () => {
    const stored = await readNoteStore()
    if (mutate(stored)) await chrome.storage.local.set({ [ELEMENT_NOTES_KEY]: stored })
    return stored
  })
  noteWriteTail = write.catch(() => {})
  return write
}

async function readNoteStoreForAddress(address) {
  const stored = await readNoteStore()
  const page = stored[address.pageKey]
  if (page === undefined || page.originalUrl !== undefined) return stored
  return writeNoteStore(current => {
    const existing = current[address.pageKey]
    if (existing === undefined || existing.originalUrl !== undefined) return false
    current[address.pageKey] = { ...address, notes: noteEntries(existing) }
    return true
  })
}

function requireNoteXPath(xpath) {
  if (typeof xpath !== 'string' || !xpath.startsWith('/') || xpath.length > 4096 || /[\r\n]/u.test(xpath)) {
    throw new Error('This element does not have a supported XPath. Pick another element.')
  }
  return xpath
}

function requireNoteText(note) {
  if (typeof note !== 'string' || note.trim() === '' || note.trim().length > 2000) {
    throw new Error('Enter a note of 1 to 2000 characters')
  }
  return note.trim()
}

function updateElementNote(draft, action, note) {
  return writeNoteStore(stored => {
    const page = stored[draft.pageKey]
    const current = noteEntries(page)
    const remaining = current.filter(entry => entry.xpath !== draft.xpath)
    if (action === 'save') {
      if (draft.savedOnly && remaining.length === current.length) throw new Error('This note has already been removed')
      if (remaining.length >= 30) throw new Error('This page has 30 notes. Remove an existing note before adding another.')
      const total = Object.values(stored).reduce((sum, page) => sum + noteEntries(page).length, 0)
      if (total >= 300 && remaining.length === current.length) {
        throw new Error('The extension has 300 saved notes. Remove an existing note before adding another.')
      }
      remaining.unshift({ xpath: draft.xpath, note })
    }
    if (action === 'remove' && remaining.length === current.length) return false
    if (remaining.length === 0) delete stored[draft.pageKey]
    else if (draft.address !== undefined) stored[draft.pageKey] = { ...draft.address, notes: remaining }
    else if (Array.isArray(page)) stored[draft.pageKey] = remaining
    else stored[draft.pageKey] = { ...page, notes: remaining }
    return true
  })
}

async function resumeElementNotePicker(tabId, draft) {
  const key = noteDraftKey(tabId)
  try {
    const tab = await chrome.tabs.get(tabId)
    const address = await elementNoteAddress(tab.url)
    if (address?.pageKey !== draft.pageKey) return false
    const viewKey = noteViewKey(tabId)
    const pending = await chrome.storage.session.get([key, viewKey])
    if (pending[key]?.token !== draft.token || pending[viewKey]?.token !== draft.pickerToken) return false
    const picker = { mode: 'pick', token: draft.pickerToken, address, expiresAt: Date.now() + ELEMENT_NOTE_DRAFT_MS }
    await chrome.storage.session.set({ [key]: picker, [viewKey]: picker })
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [draft.documentId] },
      func: startElementNoteView,
      args: [{ mode: 'pick', token: picker.token, notes: [], lifetimeMs: ELEMENT_NOTE_DRAFT_MS,
        corner: draft.corner, expectedUrl: tab.url }],
    })
    return result?.result === true
  } catch {
    // The note is already saved even if the tab or original document is gone.
    return false
  }
}

async function refreshOpenNoteLists(pageKey) {
  const state = await chrome.storage.session.get(null)
  const stored = await readNoteStore()
  const site = stored[pageKey]?.site
  await Promise.allSettled(Object.entries(state).map(async ([key, view]) => {
    if (!key.startsWith(noteViewKey('')) || view?.mode !== 'list' || view.expiresAt <= Date.now()) return
    if (site !== undefined && view.address.site !== site) return
    const tabId = Number(key.slice(noteViewKey('').length))
    await chrome.tabs.sendMessage(tabId, {
      type: 'DSH_NOTE_LIST_UPDATED', token: view.token,
      notes: collectElementNotes(stored, view.address),
    }, { frameId: 0 })
  }))
}

async function openElementNoteView(tab, mode, useContextTarget = false) {
  const tabId = requireTabId(tab?.id)
  const address = await elementNoteAddress(tab.url)
  if (address === undefined) throw new Error('Open an HTTP or HTTPS page to use element notes')
  const token = crypto.randomUUID()
  const stored = await readNoteStoreForAddress(address)
  const notes = mode === 'list' ? collectElementNotes(stored, address) : []
  const view = { mode, token, address, expiresAt: Date.now() + ELEMENT_NOTE_DRAFT_MS }
  const state = { [noteViewKey(tabId)]: view }
  if (mode === 'pick') state[noteDraftKey(tabId)] = view
  await chrome.storage.session.set(state)
  const started = await runInFrame(tabId, 0, startElementNoteView, [{
    mode, token, notes, lifetimeMs: ELEMENT_NOTE_DRAFT_MS, expectedUrl: tab.url, useContextTarget,
  }])
  if (started !== true) throw new Error('Could not open element notes on this page')
  return { ok: true }
}

async function handleElementNoteMessage(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Invalid note request')
  const popup = chrome.runtime.getURL('popup.html')
  const fromEditor = sender.url?.startsWith(popup + '?') === true

  const manager = popup + '?allNotes=1'
  if (message.type === 'DSH_NOTE_ALL') {
    if (message.action === 'open' && sender.url === popup) {
      await chrome.windows.create({ url: manager, type: 'popup', focused: true, width: 680, height: 720 })
      return { ok: true }
    }
    if (sender.url !== manager) throw new Error('Open All Notes from the extension popup')
    if (message.action === 'list') return { ok: true, notes: collectMasterElementNotes(await readNoteStore()) }
    if (message.action !== 'save' && message.action !== 'remove') throw new Error('Unknown note action')
    if (typeof message.pageKey !== 'string' || !/^[a-f0-9]{64}$/u.test(message.pageKey)) throw new Error('Invalid note page')
    const xpath = requireNoteXPath(message.xpath)
    const note = message.action === 'save' ? requireNoteText(message.note) : undefined
    const stored = await updateElementNote({ pageKey: message.pageKey, xpath, savedOnly: true }, message.action, note)
    void refreshOpenNoteLists(message.pageKey).catch(() => {})
    return { ok: true, notes: collectMasterElementNotes(stored) }
  }

  if (message.type === 'DSH_NOTE_MODE' || message.type === 'DSH_NOTE_LIST') {
    if (sender.url !== popup) throw new Error('Open the notes from the extension popup')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return openElementNoteView(tab, message.type === 'DSH_NOTE_MODE' ? 'pick' : 'list')
  }

  const editingSaved = message.type === 'DSH_NOTE_OPEN_SAVED'
  const deletingSaved = message.type === 'DSH_NOTE_DELETE_SAVED'
  const fromList = editingSaved || deletingSaved
  const fromPage = fromList || message.type === 'DSH_NOTE_SELECTED'
  if (fromPage ? sender.frameId !== 0 || sender.tab === undefined : !fromEditor) {
    throw new Error('Invalid note request')
  }
  const tabId = requireTabId(fromPage ? sender.tab.id : message.tabId)
  const key = noteDraftKey(tabId)
  const sourceKey = fromList ? noteViewKey(tabId) : key
  const draft = (await chrome.storage.session.get(sourceKey))[sourceKey]
  if (draft === undefined || typeof message.token !== 'string' || draft.token !== message.token
    || draft.expiresAt <= Date.now()) {
    throw new Error('This view expired. Open the notes again from the extension popup.')
  }

  if (fromList && draft.mode !== 'list') throw new Error('Open Page Notes from the extension popup')
  if (fromPage) {
    const xpath = requireNoteXPath(message.xpath)
    if (draft.xpath !== undefined) throw new Error('An editor is already open for this selection')
    const address = await elementNoteAddress(sender.tab.url)
    if (address?.pageKey !== draft.address.pageKey) {
      throw new Error('The page changed. Open the notes again from the extension popup.')
    }
    const pageKey = fromList ? message.pageKey : address.pageKey
    if (fromList) {
      if (typeof pageKey !== 'string' || !/^[a-f0-9]{64}$/u.test(pageKey)) throw new Error('Invalid note page')
      const page = (await readNoteStore())[pageKey]
      if ((pageKey !== address.pageKey && page?.site !== address.site)
        || !noteEntries(page).some(entry => entry.xpath === xpath)) {
        throw new Error('This note is no longer on the list. Reopen Page Notes.')
      }
      if (deletingSaved) {
        const stored = await updateElementNote({ pageKey, xpath }, 'remove')
        return { ok: true, notes: collectElementNotes(stored, address) }
      }
    }
    const editorToken = crypto.randomUUID()
    const editorDraft = { token: editorToken, pageKey, xpath, expiresAt: Date.now() + ELEMENT_NOTE_DRAFT_MS }
    if (editingSaved) {
      editorDraft.viewToken = draft.token
      editorDraft.viewAddress = address
      editorDraft.savedOnly = true
    } else {
      editorDraft.address = address
      editorDraft.pickerToken = draft.token
      editorDraft.documentId = sender.documentId
      editorDraft.corner = typeof message.corner === 'string' && /^(top|bottom)-(left|right)$/u.test(message.corner)
        ? message.corner : 'top-right'
    }
    await chrome.storage.session.set({ [key]: editorDraft })
    const editor = new URL(popup)
    editor.searchParams.set('noteTab', String(tabId))
    editor.searchParams.set('noteToken', editorToken)
    try {
      await chrome.windows.create({ url: editor.href, type: 'popup', focused: true, width: 480, height: 460 })
    } catch (error) {
      const current = (await chrome.storage.session.get(key))[key]
      if (current?.token === editorToken) {
        if (editingSaved) await chrome.storage.session.remove(key)
        else await chrome.storage.session.set({ [key]: draft })
      }
      throw error
    }
    return { ok: true }
  }

  if (draft.xpath === undefined) throw new Error('No element has been selected')
  if (message.action === 'read') {
    const stored = await readNoteStore()
    const entry = noteEntries(stored[draft.pageKey]).find(entry => entry.xpath === draft.xpath)
    return { ok: true, xpath: draft.xpath, note: entry?.note }
  }
  if (!['save', 'remove', 'cancel'].includes(message.action)) throw new Error('Unknown note action')
  const note = message.action === 'save' ? requireNoteText(message.note) : undefined
  if (message.action !== 'cancel') {
    const stored = await updateElementNote(draft, message.action, note)
    if (draft.viewToken !== undefined) {
      await chrome.tabs.sendMessage(tabId, {
        type: 'DSH_NOTE_LIST_UPDATED', token: draft.viewToken,
        notes: collectElementNotes(stored, draft.viewAddress),
      }, { frameId: 0 }).catch(() => {})
    }
  }
  const canResume = draft.pickerToken !== undefined && typeof draft.documentId === 'string'
  const resumed = canResume && await resumeElementNotePicker(tabId, draft)
  if (!resumed) {
    const current = (await chrome.storage.session.get(key))[key]
    if (current?.token === draft.token) await chrome.storage.session.remove(key)
  }
  return { ok: true, resumed }
}

/** Runs in Chrome's isolated world. Notes are edited in the extension window. */
function startElementNoteView({ mode, token, notes, lifetimeMs, corner = 'top-right', expectedUrl, useContextTarget = false }) {
  if (document.contentType !== 'text/html') throw new Error('Element notes require an HTML document')
  if (expectedUrl !== undefined && location.href !== expectedUrl) return false
  globalThis.__dshStopNotePicker?.()
  const controller = new AbortController()
  const listen = { signal: controller.signal }
  const pageUrl = location.href
  const host = document.createElement('div')
  for (const [name, value] of Object.entries({
    all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647',
    'pointer-events': 'none', overflow: 'hidden',
  })) host.style.setProperty(name, value, 'important')
  const shadow = host.attachShadow({ mode: 'closed' })
  const toolbar = document.createElement('section')
  toolbar.setAttribute('aria-label', mode === 'pick' ? 'Note Mode' : 'Page Notes')
  Object.assign(toolbar.style, {
    position: 'absolute', maxWidth: 'calc(100% - 32px)',
    boxSizing: 'border-box', pointerEvents: 'auto', padding: '12px', borderRadius: '8px',
    background: '#172337', color: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.25)',
    font: '14px/1.4 system-ui, sans-serif',
  })
  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
  })
  const status = document.createElement('span')
  status.setAttribute('role', 'status')

  function makeButton(label) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    Object.assign(button.style, {
      font: 'inherit', color: '#fff', background: '#293a54', border: '1px solid #73839e',
      borderRadius: '4px', padding: '4px 8px', cursor: 'pointer',
    })
    return button
  }

  const position = document.createElement('select')
  position.setAttribute('aria-label', 'Panel position')
  Object.assign(position.style, {
    font: 'inherit', color: '#fff', background: '#293a54', border: '1px solid #73839e',
    borderRadius: '4px', padding: '4px',
  })
  for (const [value, label] of [
    ['top-left', 'Top left'], ['top-right', 'Top right'],
    ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    position.append(option)
  }
  function placeToolbar(value) {
    corner = value
    toolbar.style.top = corner.startsWith('top-') ? '16px' : 'auto'
    toolbar.style.bottom = corner.startsWith('bottom-') ? '16px' : 'auto'
    toolbar.style.left = corner.endsWith('-left') ? '16px' : 'auto'
    toolbar.style.right = corner.endsWith('-right') ? '16px' : 'auto'
  }
  position.value = corner
  placeToolbar(corner)
  position.addEventListener('change', event => {
    if (!event.isTrusted) return
    placeToolbar(position.value)
    position.blur()
  }, listen)
  const close = makeButton(mode === 'pick' ? 'Done' : 'Close')
  header.append(status, position, close)
  toolbar.append(header)

  let cleanup = () => {}
  function stop() {
    controller.abort()
    host.remove()
    clearTimeout(timer)
    cleanup()
    if (globalThis.__dshStopNotePicker === stop) delete globalThis.__dshStopNotePicker
  }

  const timer = setTimeout(stop, lifetimeMs)
  globalThis.__dshStopNotePicker = stop
  close.addEventListener('click', event => { if (event.isTrusted) stop() }, listen)
  window.addEventListener('hashchange', stop, listen)
  window.addEventListener('popstate', stop, listen)
  window.navigation?.addEventListener('currententrychange', () => { if (location.href !== pageUrl) stop() }, listen)

  function makeOutline() {
    const outline = document.createElement('div')
    Object.assign(outline.style, {
      position: 'absolute', boxSizing: 'border-box', border: '2px solid #60a5fa',
      background: 'rgba(96,165,250,.12)', pointerEvents: 'none', display: 'none',
    })
    return outline
  }

  function drawOutline(outline, element, active = false) {
    const rect = element?.getBoundingClientRect()
    const visible = rect !== undefined && rect.width > 0 && rect.height > 0
    outline.style.display = visible ? 'block' : 'none'
    if (visible) {
      Object.assign(outline.style, {
        left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px',
        borderColor: active ? '#fbbf24' : '#60a5fa',
      })
    }
    return visible
  }

  async function openEditor(type, xpath, pageKey) {
    const result = await chrome.runtime.sendMessage({ type, token, xpath, corner, pageKey })
    if (result?.ok !== true) throw new Error(result?.error ?? 'Could not open the note editor')
  }

  function showPicker() {
    const shield = document.createElement('div')
    Object.assign(shield.style, { position: 'absolute', inset: '0', pointerEvents: 'auto', cursor: 'crosshair' })
    const outline = makeOutline()
    shadow.append(shield, outline, toolbar)
    const captured = useContextTarget ? globalThis.__dshNoteContext : undefined
    delete globalThis.__dshNoteContext
    const age = captured === undefined ? Infinity : performance.now() - captured.time
    const target = captured?.url === pageUrl && age >= 0 && age <= 60_000 ? captured.element.deref() : undefined
    let hovered = target?.isConnected && target.ownerDocument === document ? target : null
    let selected = hovered
    let contextSelection = selected !== null
    const previousChildren = []
    let opening = false
    const useSelection = selected === null ? null : makeButton('Add note')
    if (useSelection !== null) {
      header.insertBefore(useSelection, close)
      useSelection.addEventListener('click', event => {
        if (event.isTrusted) void openSelection()
      }, listen)
    }

    function renderSelection() {
      drawOutline(outline, selected)
      const target = selected === null ? 'an element' : '<' + selected.localName + '>'
      status.textContent = contextSelection && selected !== null
        ? 'Selected ' + target + '. Up widens, Down narrows.'
        : 'Click to select ' + target + '. Up widens, Down narrows.'
      if (useSelection !== null) useSelection.disabled = selected === null || opening
    }

    function updateHover(event) {
      // Keep the right-click selection while the pointer travels to the toolbar.
      if (contextSelection && selected?.isConnected) return
      contextSelection = false
      shield.style.pointerEvents = 'none'
      let hit
      try { hit = document.elementFromPoint(event.clientX, event.clientY) }
      finally { shield.style.pointerEvents = 'auto' }
      if (hit === host) hit = null
      // Keep the keyboard choice until the pointer moves to another element.
      if (hit === hovered && selected?.isConnected !== false) return
      hovered = hit
      selected = hit
      previousChildren.length = 0
    }

    async function openSelection() {
      if (opening || selected === null || !selected.isConnected) return
      opening = true
      if (useSelection !== null) useSelection.disabled = true
      status.textContent = 'Opening note editor...'
      try {
        await openEditor('DSH_NOTE_SELECTED', absoluteXPath(selected))
        stop()
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error)
        opening = false
        if (useSelection !== null) useSelection.disabled = false
      }
    }

    renderSelection()
    shield.addEventListener('pointermove', event => {
      if (opening) return
      updateHover(event)
      renderSelection()
    }, listen)
    shield.addEventListener('pointerleave', () => {
      if (!contextSelection) outline.style.display = 'none'
    }, listen)
    shield.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (!event.isTrusted || opening) return
      updateHover(event)
      void openSelection()
    }, listen)
    window.addEventListener('keydown', event => {
      if (!event.isTrusted || event.target === host || opening || selected === null
        || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'ArrowUp') {
        const parent = selected.parentElement
        if (parent !== null) {
          previousChildren.push(selected)
          selected = parent
        }
      } else {
        const child = previousChildren.pop()
        if (child?.parentElement === selected) selected = child
        else {
          selected = Array.from(selected.children)
            .find(element => element !== host && element.getClientRects().length > 0) ?? selected
        }
      }
      renderSelection()
    }, { ...listen, capture: true })
    window.addEventListener('scroll', () => drawOutline(outline, selected), { ...listen, capture: true })
    window.addEventListener('resize', () => drawOutline(outline, selected), listen)
  }

  function showNotes() {
    const outlines = document.createElement('div')
    const list = document.createElement('div')
    toolbar.style.width = '340px'
    Object.assign(list.style, { maxHeight: '60vh', overflow: 'auto', marginTop: '8px' })
    toolbar.append(list)
    shadow.append(outlines, toolbar)
    let rows = []
    let activeXPath
    let animationFrame
    let needsLookup = false
    let opening = false

    function lookup(xpath) {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        const element = result.singleNodeValue
        return element instanceof Element && element !== host ? element : null
      } catch {
        return null
      }
    }

    function draw(resolve) {
      animationFrame = undefined
      if (location.href !== pageUrl) {
        stop()
        return
      }
      for (const row of rows) {
        if (!row.onCurrentPage) continue
        if (resolve) row.element = lookup(row.xpath)
        const visible = drawOutline(row.outline, row.element, row.xpath === activeXPath)
        row.locate.disabled = !visible
        row.unavailable.hidden = visible
        row.unavailable.textContent = row.element === null ? 'Element not found' : 'Element is hidden'
      }
    }

    function scheduleDraw(resolve = false) {
      needsLookup ||= resolve
      if (animationFrame !== undefined) return
      animationFrame = requestAnimationFrame(() => {
        const resolveNow = needsLookup
        needsLookup = false
        draw(resolveNow)
      })
    }

    function render(entries) {
      status.textContent = entries.length === 0 ? 'No notes for this site.' : 'Notes on this site'
      rows = entries.map(({ xpath, note, pageKey, pageUrl, canOpen, onCurrentPage }, index) => {
        const number = String(index + 1)
        const row = document.createElement('div')
        Object.assign(row.style, { borderTop: '1px solid #53627a', padding: '8px 0' })
        const source = document.createElement('div')
        Object.assign(source.style, { fontSize: '12px', color: '#c6d2e4', overflowWrap: 'anywhere' })
        if (onCurrentPage) {
          source.textContent = 'This page'
        } else if (canOpen) {
          const link = document.createElement('a')
          link.href = pageUrl
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = pageUrl
          link.style.color = '#bfdbfe'
          source.append(link)
        } else {
          source.textContent = pageUrl + ' (page variant)'
        }
        const description = document.createElement('div')
        description.textContent = number + '. ' + note
        Object.assign(description.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: '6px' })
        const actions = document.createElement('div')
        Object.assign(actions.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' })
        const locate = makeButton('Locate')
        locate.setAttribute('aria-label', 'Locate note ' + number)
        const edit = makeButton('Edit')
        edit.setAttribute('aria-label', 'Edit note ' + number)
        const remove = makeButton('Delete')
        remove.title = 'Double-click within 200 ms to delete'
        remove.setAttribute('aria-label', 'Delete note ' + number + ' with two clicks within 200 milliseconds')
        const unavailable = document.createElement('span')
        unavailable.hidden = true
        locate.disabled = true
        if (onCurrentPage) actions.append(locate)
        actions.append(edit, remove, unavailable)
        row.append(source, description, actions)

        const outline = makeOutline()
        const badge = document.createElement('span')
        badge.textContent = number
        Object.assign(badge.style, {
          position: 'absolute', top: '0', left: '0', background: '#172337', color: '#fff',
          padding: '1px 5px', borderRadius: '0 0 4px 0', font: '600 12px/1.5 system-ui, sans-serif',
        })
        outline.append(badge)
        const view = { xpath, onCurrentPage, row, outline, locate, unavailable, element: null }
        locate.addEventListener('click', event => {
          if (!event.isTrusted) return
          view.element = lookup(xpath)
          view.element?.scrollIntoView({ block: 'center', inline: 'nearest' })
          activeXPath = xpath
          scheduleDraw(true)
        })
        edit.addEventListener('click', async event => {
          if (!event.isTrusted || opening) return
          opening = true
          edit.disabled = true
          try {
            await openEditor('DSH_NOTE_OPEN_SAVED', xpath, pageKey)
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error)
          } finally {
            opening = false
            edit.disabled = false
          }
        })
        let firstDeleteClick
        remove.addEventListener('click', async event => {
          if (!event.isTrusted || event.button !== 0 || event.detail === 0 || opening) return
          const elapsed = event.timeStamp - firstDeleteClick
          if (firstDeleteClick === undefined || elapsed < 0 || elapsed > 200) {
            firstDeleteClick = event.timeStamp
            return
          }
          firstDeleteClick = undefined
          opening = true
          remove.disabled = true
          try {
            const result = await chrome.runtime.sendMessage({ type: 'DSH_NOTE_DELETE_SAVED', token, xpath, pageKey })
            if (result?.ok !== true) throw new Error(result?.error ?? 'Could not delete the note')
            if (!controller.signal.aborted) render(result.notes)
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error)
          } finally {
            opening = false
            remove.disabled = false
          }
        })
        return view
      })
      list.replaceChildren(...rows.map(row => row.row))
      outlines.replaceChildren(...rows.filter(row => row.onCurrentPage).map(row => row.outline))
      scheduleDraw(true)
    }

    function onNotesUpdated(message, sender) {
      if (sender.id === chrome.runtime.id && message?.type === 'DSH_NOTE_LIST_UPDATED'
        && message.token === token && Array.isArray(message.notes)) render(message.notes)
    }
    const observer = new MutationObserver(() => scheduleDraw(true))
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
    chrome.runtime.onMessage.addListener(onNotesUpdated)
    window.addEventListener('scroll', () => scheduleDraw(), { ...listen, capture: true })
    window.addEventListener('resize', () => scheduleDraw(), listen)
    cleanup = () => {
      observer.disconnect()
      chrome.runtime.onMessage.removeListener(onNotesUpdated)
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
    }
    render(notes)
  }

  function absoluteXPath(element) {
    const parts = []
    for (let node = element; node !== null; node = node.parentElement) {
      // Use positional wildcards for SVG and MathML to avoid namespace prefixes.
      const named = node.namespaceURI === 'http://www.w3.org/1999/xhtml'
        && /^[a-z][a-z0-9_-]*$/i.test(node.localName)
      let index = 1
      for (let sibling = node.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
        if (!named || (sibling.namespaceURI === node.namespaceURI && sibling.localName === node.localName)) index++
      }
      parts.unshift((named ? node.localName : '*') + '[' + index + ']')
    }
    return '/' + parts.join('/')
  }

  window.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      stop()
    }
  }, { ...listen, capture: true })
  document.documentElement.append(host)
  if (mode === 'pick') showPicker()
  else showNotes()
  return true
}

/** Runs inside the target frame: snapshot payload plus a best-effort grid-cell dump. */
function frameSnapshotPayload(maxChars) {
  // Mask common token patterns in returned strings; other secret formats can remain.
  const redact = value => String(value)
    .replace(/(access_token(?:=|%3D))[^&"'\s]+/gi, '$1<redacted>')
    .replace(/(["']access_token["']\s*:\s*["'])[^"']+/gi, '$1<redacted>')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"'\s]+/gi, '$1<redacted>')
  const text = redact(document.body?.innerText ?? '').slice(0, maxChars)
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(link => ({
    text: redact(link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 240),
    url: redact(link.href),
  }))
  const cells = Array.from(document.querySelectorAll('[role="gridcell"],[role="rowheader"],[role="columnheader"],[aria-rowindex]'))
    .slice(0, 2000)
    .map(el => ({
      role: el.getAttribute('role') === null ? null : redact(el.getAttribute('role')),
      label: redact(el.getAttribute('aria-label') || '').slice(0, 200),
      text: redact(el.textContent || '').trim().slice(0, 200),
    }))
    .filter(cell => cell.label !== '' || cell.text !== '')
  const inputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
    .slice(0, 60)
    .map(el => {
      const raw = String(el.value ?? el.textContent ?? '')
      const isJsonState = /json|context/i.test(el.id ?? '')
      return {
        id: el.id ? redact(el.id) : null,
        cls: redact(el.className).slice(0, 80),
        label: redact(el.getAttribute('aria-label') || '').slice(0, 120),
        valueLength: raw.length,
        value: redact(raw).slice(0, isJsonState ? 60_000 : 200),
      }
    })
  let usedRange = null
  try {
    const ctx = document.querySelector('#m_excelWebRenderer_ewaCtl_m_workbookContextJson')
    if (ctx !== null) usedRange = JSON.parse(ctx.value)?.ActiveSheetProcessedDataResult?.UR ?? null
  } catch { usedRange = null }
  const rectOf = el => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const rects = {}
  for (const sel of [
    '#FormulaBar-NameBox-input',
    '#formulaBarTextDivId_textElement',
    '#m_excelWebRenderer_ewaCtl_okboxButton',
    '#m_excelWebRenderer_ewaCtl_cancelboxButton',
    '.ewr-grdcontarea-grid',
    '.ewr-sheettable',
  ]) {
    const el = document.querySelector(sel)
    if (el !== null) rects[sel] = rectOf(el)
  }
  const canvasRects = Array.from(document.querySelectorAll('canvas'))
    .slice(0, 8)
    .map(c => ({ cls: redact(c.className).slice(0, 60), ...rectOf(c) }))
  return {
    title: redact(document.title),
    url: redact(location.href),
    text,
    links,
    inputs,
    usedRange,
    rects,
    canvasRects,
    officeGlobals: Object.getOwnPropertyNames(window)
      .filter(k => /^(Office|Excel|_ExcelJs|Ewa|WAC)/i.test(k))
      .slice(0, 30),
    hasOffice: typeof Office !== 'undefined',
    hasExcel: typeof Excel !== 'undefined',
    grid: {
      cellCount: cells.length,
      cells,
      canvasCount: document.querySelectorAll('canvas').length,
      gridRoleCount: document.querySelectorAll('[role="grid"]').length,
    },
  }
}

/** Runs inside the target frame: outerHTML of the document or one CSS-selected element. */
function frameHtmlPayload(selector, maxChars) {
  let root = document.documentElement
  if (selector !== undefined && selector !== null) {
    const el = document.querySelector(selector)
    if (el === null) throw new Error('The CSS selector did not match an element')
    root = el
  }
  const html = root?.outerHTML ?? ''
  return { html: html.slice(0, maxChars), totalChars: html.length, truncated: html.length > maxChars }
}

/** Runs inside the target frame: evaluate one expression. MV3 CSP may block the Function constructor. */
function frameEvalPayload(expression) {
  try {
    const fn = new Function('return (' + expression + ')')
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, error: 'Frame evaluation blocked or failed: ' + String(error?.message ?? error) }
  }
}

/** Report API shapes only, without returning workbook values or credentials. */
async function frameWorkbookProbePayload() {
  const names = ['Ewa', '_Ewa', 'Excel', 'Office', '_ExcelJs', 'Wac']
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u
  const safeKeys = value => {
    if (value === null || !['object', 'function'].includes(typeof value)) return { count: 0, names: [] }
    const keys = Object.keys(value)
      .filter(key => identifier.test(key))
    return { count: keys.length, names: keys.slice(0, 60) }
  }
  const shape = (value, includePrototype = true) => {
    const type = typeof value
    if (value === null) return { type: 'null' }
    if (!['object', 'function'].includes(type)) return { type }
    if (Array.isArray(value)) return { type: 'array', length: value.length }
    if (ArrayBuffer.isView(value)) return { type: 'typed-array', length: value.length ?? 0 }
    const names = Object.getOwnPropertyNames(value)
      .filter(name => identifier.test(name)
        && (type !== 'function' || !['length', 'name', 'arguments', 'caller', 'prototype'].includes(name)))
    const members = names.slice(0, 80).map(name => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (descriptor === undefined) return { name, type: 'unavailable' }
      if (!Object.hasOwn(descriptor, 'value')) return { name, type: 'accessor' }
      const member = descriptor.value
      return { name, type: member === null ? 'null' : typeof member,
        ...(typeof member === 'function' ? { arity: member.length } : {}) }
    })
    let prototype
    if (includePrototype) {
      const parent = Object.getPrototypeOf(value)
      if (parent !== null && parent !== Object.prototype && parent !== Function.prototype) {
        prototype = shape(parent, false)
      }
    }
    return {
      type,
      ...(type === 'function' ? { arity: value.length } : {}),
      memberCount: names.length,
      members,
      truncated: names.length > members.length,
      ...(prototype === undefined ? {} : { prototype }),
    }
  }
  const memberInfo = (owner, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    if (descriptor === undefined) return { name, type: 'unavailable' }
    if (!Object.hasOwn(descriptor, 'value')) return { name, type: 'accessor' }
    const value = descriptor.value
    return { name, type: value === null ? 'null' : typeof value,
      ...(typeof value === 'function' ? { arity: value.length } : {}) }
  }
  const gridDetails = grid => {
    if (grid === null || !['object', 'function'].includes(typeof grid)) return null
    const relevant = /range|values?|cell|sheet|model|workbook|data|get|a1/iu
    const prototype = Object.getPrototypeOf(grid)
    const prototypeNames = prototype === null ? [] : Object.getOwnPropertyNames(prototype)
      .filter(name => identifier.test(name))
    const ownNames = Object.getOwnPropertyNames(grid).filter(name => identifier.test(name))
    const objectMembers = []
    for (const name of ownNames) {
      const descriptor = Object.getOwnPropertyDescriptor(grid, name)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      const value = descriptor.value
      if (value === null || typeof value !== 'object') continue
      try {
        const own = Object.getOwnPropertyNames(value).filter(key => identifier.test(key))
        const parent = Object.getPrototypeOf(value)
        const inherited = parent === null ? [] : Object.getOwnPropertyNames(parent)
          .filter(key => identifier.test(key))
        objectMembers.push({
          name,
          result: {
            type: Array.isArray(value) ? 'array' : 'object',
            ...(Array.isArray(value) ? { length: value.length } : {}),
            ownMemberCount: own.length,
            ownMembers: own.slice(0, 32).map(key => memberInfo(value, key)),
            prototypeMemberCount: inherited.length,
            prototypeMembers: inherited.slice(0, 32).map(key => memberInfo(parent, key)),
          },
          relevantOwn: own.filter(key => relevant.test(key)).slice(0, 80)
            .map(key => memberInfo(value, key)),
          relevantPrototype: inherited.filter(key => relevant.test(key)).slice(0, 80)
            .map(key => memberInfo(parent, key)),
        })
      } catch {
        objectMembers.push({ name, type: 'unreadable' })
      }
      if (objectMembers.length >= 32) break
    }
    return {
      ownMemberCount: ownNames.length,
      relevantOwn: ownNames.filter(name => relevant.test(name)).slice(0, 100)
        .map(name => memberInfo(grid, name)),
      prototypeMemberCount: prototypeNames.length,
      prototypeMembers: prototypeNames.slice(0, 500).map(name => memberInfo(prototype, name)),
      relevantPrototype: prototypeNames.filter(name => relevant.test(name)).slice(0, 100),
      objectMemberCount: objectMembers.length,
      objectMembers,
      truncated: prototypeNames.length > 500 || objectMembers.length >= 32,
    }
  }
  const settle = (value, timeoutMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs)
    Promise.resolve(value).then(
      result => { clearTimeout(timer); resolve(result) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
  const errorShape = error => ({ errorType: String(error?.name ?? 'Error').slice(0, 80),
    error: String(error?.message ?? error)
      .replace(/access_token=[^&\s"'<>]+/gi, 'access_token=<redacted>')
      .slice(0, 240) })
  const globals = {}
  for (const name of names) {
    try {
      const value = globalThis[name]
      globals[name] = {
        type: typeof value,
        keys: safeKeys(value),
        ewaControlType: typeof value?.EwaControl,
        getInstancesType: typeof value?.EwaControl?.getInstances,
        ...(name === '_Ewa' ? { gimType: typeof value?.Gim, gimKeys: safeKeys(value?.Gim) } : {}),
      }
    } catch {
      globals[name] = { type: 'unreadable' }
    }
  }
  const matchingGlobalNames = Object.getOwnPropertyNames(globalThis)
    .filter(name => /ewa|excel|office|wac/iu.test(name)
      && identifier.test(name))
    .slice(0, 60)
  const internals = {}
  const paths = [
    ['_Ewa.Gim', ['_Ewa', 'Gim']],
    ['_Ewa.CrossFrameStaticMethods', ['_Ewa', 'CrossFrameStaticMethods']],
    ['ewamain', ['ewamain']],
    ['ewarender', ['ewarender']],
    ['excelOnline', ['excelOnline']],
    ['excelOnlineCalc', ['excelOnlineCalc']],
    ['_ewaPrefetchGetRanges', ['_ewaPrefetchGetRanges']],
    ['__SetupXviJsDefaultsFromEwa', ['__SetupXviJsDefaultsFromEwa']],
  ]
  for (const [name, parts] of paths) {
    try {
      let value = globalThis
      for (const part of parts) value = value?.[part]
      internals[name] = shape(value)
    } catch {
      internals[name] = { type: 'unreadable' }
    }
  }
  let crossFrameGetEwaControl
  try {
    crossFrameGetEwaControl = shape(globalThis._Ewa?.CrossFrameStaticMethods?.getEwaControl)
  } catch {
    crossFrameGetEwaControl = { type: 'unreadable' }
  }
  let crossFrameImports
  try {
    crossFrameImports = shape(globalThis._Ewa?.CrossFrameStaticMethods?.imports)
  } catch {
    crossFrameImports = { type: 'unreadable' }
  }
  let crossFrameControl
  try {
    const crossFrame = globalThis._Ewa?.CrossFrameStaticMethods
    const exported = crossFrame?.getEwaControl
    const returned = typeof exported === 'function' ? exported.call(crossFrame) : exported
    const thenable = returned !== null && returned !== undefined && typeof returned.then === 'function'
    const resolved = await settle(returned, 4_000)
    let wkb
    try {
      const workbook = resolved?.wkb
      wkb = { thenable: workbook !== null && workbook !== undefined && typeof workbook.then === 'function',
        result: shape(await settle(workbook, 3_000)) }
    } catch (error) {
      wkb = errorShape(error)
    }
    crossFrameControl = { thenable, result: shape(resolved), wkb }
  } catch (error) {
    crossFrameControl = errorShape(error)
  }
  let crossFrameGrid
  try {
    const imports = globalThis._Ewa?.CrossFrameStaticMethods?.imports
    const exported = imports?.grid
    const returned = typeof exported === 'function' ? exported.call(imports) : exported
    crossFrameGrid = {
      export: shape(exported),
      thenable: returned !== null && returned !== undefined && typeof returned.then === 'function',
      result: null,
    }
    const grid = await settle(returned, 3_000)
    crossFrameGrid.result = shape(grid)
    crossFrameGrid.details = gridDetails(grid)
    const leads = {}
    const relevant = /range|values?|cell|sheet|model|workbook|data|get|a1/iu
    for (const [name, read] of [
      ['usedRange', () => grid?.usedRange],
      ['mcSheets', () => grid?.mc?.sheets],
    ]) {
      try {
        const value = read()
        const resolved = await settle(value, 3_000)
        const own = resolved !== null && ['object', 'function'].includes(typeof resolved)
          ? Object.getOwnPropertyNames(resolved).filter(key => identifier.test(key)) : []
        const parent = resolved !== null && ['object', 'function'].includes(typeof resolved)
          ? Object.getPrototypeOf(resolved) : null
        const inherited = parent === null ? [] : Object.getOwnPropertyNames(parent)
          .filter(key => identifier.test(key))
        leads[name] = { thenable: value !== null && value !== undefined && typeof value.then === 'function',
          result: shape(resolved),
          relevantOwn: own.filter(key => relevant.test(key)).slice(0, 80)
            .map(key => memberInfo(resolved, key)),
          relevantPrototype: inherited.filter(key => relevant.test(key)).slice(0, 80)
            .map(key => memberInfo(parent, key)) }
      } catch (error) {
        leads[name] = errorShape(error)
      }
    }
    const sheetModels = []
    try {
      const modelMap = grid?.nGi
      if (modelMap !== null && ['object', 'function'].includes(typeof modelMap)) {
        const names = Object.getOwnPropertyNames(modelMap)
          .filter(name => /^Sheet/iu.test(name) && identifier.test(name)).slice(0, 10)
        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(modelMap, name)
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
          const value = descriptor.value
          if (value === null || !['object', 'function'].includes(typeof value)) continue
          const own = Object.getOwnPropertyNames(value).filter(key => identifier.test(key))
          const parent = Object.getPrototypeOf(value)
          const inherited = parent === null ? [] : Object.getOwnPropertyNames(parent)
            .filter(key => identifier.test(key))
          sheetModels.push({ name, result: shape(value),
            relevantOwn: own.filter(key => relevant.test(key)).slice(0, 80)
              .map(key => memberInfo(value, key)),
            relevantPrototype: inherited.filter(key => relevant.test(key)).slice(0, 80)
              .map(key => memberInfo(parent, key)) })
        }
      }
    } catch (error) {
      leads.sheetModelsError = errorShape(error)
    }
    leads.sheetModels = sheetModels
    crossFrameGrid.leads = leads
  } catch (error) {
    crossFrameGrid = errorShape(error)
  }
  return {
    probeVersion: 7,
    readyState: document.readyState,
    hasWorkbookContext: document.querySelector('#m_excelWebRenderer_ewaCtl_m_workbookContextJson') !== null,
    matchingGlobalNames,
    globals,
    internals,
    crossFrameGetEwaControl,
    crossFrameImports,
    crossFrameControl,
    crossFrameGrid,
  }
}

/** Read one Excel sheet range through APIs already loaded in the app frame. */
const ELEMENT_WATCH_MAX_ENTRIES = 5_000
const ELEMENT_WATCH_MAX_VALUE_CHARS = 500
// NOTE: the frame-injected payload functions below must stay self-contained; they inline
// the 5000/500 limits as literals because module constants are not serialized into the frame.

/**
 * Runs inside the target frame's MAIN world: start a generic element watcher that records
 * the watched element's text/value (and an optional label element's value) on every change.
 * Idempotent per selector pair; the log lives at window.__dshElementWatchLog.
 */
function frameElementWatchStartPayload(selector, labelSelector) {
  try {
    const key = String(selector) + '|' + String(labelSelector ?? '')
    const previousWatch = window.__dshElementWatch
    if (previousWatch !== undefined && previousWatch.key === key && typeof previousWatch.stop === 'function') {
      return { started: false, already: true, logged: (window.__dshElementWatchLog ?? []).length }
    }
    const el = document.querySelector(String(selector))
    if (el === null) return { error: 'No element matches selector: ' + String(selector).slice(0, 120) }
    const labelEl = labelSelector ? document.querySelector(String(labelSelector)) : null

    if (previousWatch !== undefined) {
      if (typeof previousWatch.stop === 'function') previousWatch.stop()
      else {
        clearInterval(previousWatch.timer)
        previousWatch.observer?.disconnect()
        delete window.__dshElementWatch
      }
    }

    const log = []
    window.__dshElementWatchLog = log
    const watch = {
      key,
      timer: null,
      observers: [],
      listeners: [],
      timeouts: new Set(),
      active: true,
      stop: null,
    }
    const cleanup = () => {
      if (!watch.active) return
      watch.active = false
      if (watch.timer !== null) clearInterval(watch.timer)
      for (const observer of watch.observers) observer.disconnect()
      for (const { target, type, listener, options } of watch.listeners) {
        target.removeEventListener(type, listener, options)
      }
      for (const timeout of watch.timeouts) clearTimeout(timeout)
      watch.timeouts.clear()
      if (window.__dshElementWatch === watch) delete window.__dshElementWatch
    }
    watch.stop = cleanup

    const readValue = () => {
      const raw = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent
      return String(raw ?? '').slice(0, 500)
    }
    const readLabel = () => {
      if (labelEl === null) return ''
      const raw = labelEl instanceof HTMLInputElement ? labelEl.value : labelEl.textContent
      return String(raw ?? '').slice(0, 200)
    }
    let lastKey = ''
    const record = () => {
      if (!watch.active) return
      const value = readValue()
      const label = readLabel()
      const entryKey = label + '\n' + value
      if (entryKey === lastKey) return
      lastKey = entryKey
      const currentLog = Array.isArray(window.__dshElementWatchLog)
        ? window.__dshElementWatchLog
        : (window.__dshElementWatchLog = [])
      currentLog.push({ label, value, at: Date.now() })
      if (currentLog.length > 5_000) currentLog.splice(0, currentLog.length - 5_000)
    }

    try {
      const observer = new MutationObserver(() => record())
      watch.observers.push(observer)
      observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['value'] })
      const inputListener = () => record()
      watch.listeners.push({ target: el, type: 'input', listener: inputListener })
      el.addEventListener('input', inputListener)
      if (labelEl !== null) {
        const labelObserver = new MutationObserver(() => record())
        watch.observers.push(labelObserver)
        labelObserver.observe(labelEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['value'] })
        const labelInputListener = () => record()
        watch.listeners.push({ target: labelEl, type: 'input', listener: labelInputListener })
        labelEl.addEventListener('input', labelInputListener)
      }
      const clickListener = () => {
        const timeout = setTimeout(() => {
          watch.timeouts.delete(timeout)
          record()
        }, 60)
        watch.timeouts.add(timeout)
      }
      watch.listeners.push({ target: document, type: 'click', listener: clickListener, options: true })
      document.addEventListener('click', clickListener, true)
      watch.timer = setInterval(record, 250)
      window.__dshElementWatch = watch
      record()
    } catch (error) {
      cleanup()
      throw error
    }

    return { started: true, logged: log.length, selector: String(selector) }
  } catch (error) {
    return { error: 'element watch start failed: ' + String(error?.message ?? error).slice(0, 240) }
  }
}

/** Runs inside the target frame's MAIN world: stop the element watcher. */
function frameElementWatchStopPayload() {
  try {
    const watch = window.__dshElementWatch
    if (watch === undefined) return { stopped: false, wasRunning: false }
    const logged = (window.__dshElementWatchLog ?? []).length
    if (typeof watch.stop === 'function') watch.stop()
    else {
      clearInterval(watch.timer)
      watch.observer?.disconnect()
      if (Array.isArray(window.__dshElementWatchLog)) {
        window.__dshElementWatchLog = window.__dshElementWatchLog.slice()
      }
      delete window.__dshElementWatch
    }
    return { stopped: true, wasRunning: true, logged }
  } catch (error) {
    return { error: 'element watch stop failed: ' + String(error?.message ?? error).slice(0, 240) }
  }
}

/** Runs inside the target frame's MAIN world: read (and optionally clear) the recorded log. */
function frameElementWatchReadPayload(clear) {
  try {
    const log = Array.isArray(window.__dshElementWatchLog) ? window.__dshElementWatchLog : []
    const entries = log.map(entry => ({ label: String(entry.label ?? ''), value: String(entry.value ?? ''), at: entry.at }))
    if (clear === true) window.__dshElementWatchLog = []
    return { running: window.__dshElementWatch !== undefined, count: entries.length, entries }
  } catch (error) {
    return { error: 'element watch read failed: ' + String(error?.message ?? error).slice(0, 240) }
  }
}

async function frameWorkbookValuesPayload(maxCells, maxResultChars) {
  const input = document.querySelector('#m_excelWebRenderer_ewaCtl_m_workbookContextJson')
  if (input === null) return { error: 'No Excel workbook context was found in this frame' }
  let workbookContext
  try {
    workbookContext = JSON.parse(input.value)
  } catch {
    return { error: 'The Excel workbook context is not valid JSON' }
  }
  const sheetName = workbookContext?.ActiveSheetName
  if (typeof sheetName !== 'string' || sheetName === '') {
    return { error: 'The active Excel sheet name is unavailable' }
  }
  const usedRange = workbookContext?.ActiveSheetProcessedDataResult?.UR
  const lastRow = Number(usedRange?.LastRow)
  const lastColumn = Number(usedRange?.LastColumn)
  const validBounds = Number.isSafeInteger(lastRow) && lastRow >= 0
    && Number.isSafeInteger(lastColumn) && lastColumn >= 0
  const failures = []
  const describe = error => String(error?.message ?? error)
    .replace(/access_token=[^&\s"'<>]+/gi, 'access_token=<redacted>')
    .slice(0, 240)
  const deadline = Date.now() + 25_000
  const timed = (operation, timeoutMs) => new Promise((resolve, reject) => {
    const remainingMs = Math.min(timeoutMs, Math.max(1, deadline - Date.now()))
    const timer = setTimeout(() => reject(new Error('timed out')), remainingMs)
    Promise.resolve().then(operation).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
  const packageValues = (api, address, values, formulas) => {
    if (!Array.isArray(values) || values.length === 0 || !Array.isArray(values[0])
      || values[0].length === 0 || values.some(row => !Array.isArray(row) || row.length !== values[0].length)) {
      throw new Error('The workbook API returned an invalid value matrix')
    }
    const rowCount = values.length
    const columnCount = values[0].length
    if (rowCount * columnCount > maxCells) {
      throw new Error('The used range exceeds the ' + String(maxCells) + '-cell read limit')
    }
    const populated = values.map((row, rowIndex) => row.map((value, columnIndex) =>
      (value !== null && value !== undefined && value !== '')
      || (typeof formulas?.[rowIndex]?.[columnIndex] === 'string'
        && formulas[rowIndex][columnIndex].startsWith('='))))
    const result = {
      api,
      sheetName,
      address,
      rowCount,
      columnCount,
      values,
      populated,
      populationBasis: api === 'office-js' ? 'nonempty-value-or-formula' : 'nonempty-value',
    }
    if (JSON.stringify(result).length > maxResultChars) {
      throw new Error('The used range exceeds the workbook response size limit')
    }
    return result
  }

  const validateEwaBounds = () => {
    if (!validBounds) throw new Error('EWA used-range bounds are unavailable')
    if ((lastRow + 1) * (lastColumn + 1) > maxCells) {
      throw new Error('EWA used range exceeds the ' + String(maxCells) + '-cell read limit')
    }
  }
  const readEwaRange = async (api, range) => {
    validateEwaBounds()
    if (typeof range?.getValuesAsync !== 'function') throw new Error('EWA range has no getValuesAsync')
    const address = typeof range.getAddressA1 === 'function'
      ? await timed(() => range.getAddressA1(), 4_000) : null
    const values = await timed(() => new Promise((resolve, reject) => {
      range.getValuesAsync(0, result => {
        try {
          const code = result?.getCode?.()
          if (code === 0 || (code === undefined && result?.getSucceeded?.() === true)) {
            resolve(result.getReturnValue())
          } else reject(new Error(result?.getDescription?.() ?? 'EWA range read failed'))
        } catch (error) {
          reject(error)
        }
      }, null)
    }), 12_000)
    return packageValues(api, address, values)
  }
  const readEwaSheets = async (api, sheets) => {
    validateEwaBounds()
    if (typeof sheets?.getItemByName !== 'function') throw new Error('EWA sheets have no getItemByName')
    const sheet = await timed(() => sheets.getItemByName(sheetName), 4_000)
    if (typeof sheet?.getRange !== 'function') throw new Error('EWA sheet has no getRange')
    const range = await timed(() => sheet.getRange(0, 0, lastRow + 1, lastColumn + 1), 4_000)
    return readEwaRange(api, range)
  }
  const readEwaWorkbook = async (api, workbook) => {
    if (typeof workbook?.getSheets !== 'function') {
      throw new Error('No EWA workbook with getSheets was returned (type '
        + (workbook === null ? 'null' : typeof workbook) + ')')
    }
    const sheets = await timed(() => workbook.getSheets(), 4_000)
    return readEwaSheets(api, sheets)
  }
  const readEwaControl = async (api, control) => {
    if (typeof control?.getActiveWorkbook !== 'function') {
      throw new Error('No EWA control with getActiveWorkbook was returned (type '
        + (control === null ? 'null' : typeof control) + ')')
    }
    const workbook = await timed(() => control.getActiveWorkbook(), 4_000)
    return readEwaWorkbook(api, workbook)
  }

  const seenEwa = new Set()
  for (const [api, ewa] of [['ewa', globalThis.Ewa], ['_ewa', globalThis._Ewa]]) {
    if (seenEwa.has(ewa) || typeof ewa?.EwaControl?.getInstances !== 'function') continue
    seenEwa.add(ewa)
    try {
      return await readEwaControl(api, ewa.EwaControl.getInstances().getItem(0))
    } catch (error) {
      failures.push(api + ' read failed: ' + describe(error))
    }
  }

  try {
    const crossFrame = globalThis._Ewa?.CrossFrameStaticMethods
    const exported = crossFrame?.getEwaControl
    if (exported !== undefined) {
      const returned = typeof exported === 'function' ? exported.call(crossFrame) : exported
      const resolved = await timed(() => Promise.resolve(returned), 8_000)
      let control = resolved
      if (typeof control?.getActiveWorkbook !== 'function'
        && control !== null && ['object', 'function'].includes(typeof control)) {
        const names = Object.getOwnPropertyNames(control).slice(0, 40)
        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(control, name)
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
          if (typeof descriptor.value?.getActiveWorkbook === 'function') {
            control = descriptor.value
            break
          }
        }
      }
      if (typeof control?.getActiveWorkbook === 'function') {
        return await readEwaControl('ewa-cross-frame', control)
      }
      const workbook = await timed(() => Promise.resolve(resolved?.wkb), 4_000)
      if (typeof workbook?.getSheets === 'function') {
        return await readEwaWorkbook('ewa-cross-frame-wkb', workbook)
      }
      if (workbook !== undefined) {
        throw new Error('Cross-frame wkb has no getSheets (type '
          + (workbook === null ? 'null' : typeof workbook) + ')')
      }
      return await readEwaControl('ewa-cross-frame', control)
    }
  } catch (error) {
    failures.push('ewa-cross-frame read failed: ' + describe(error))
  }

  try {
    const imports = globalThis._Ewa?.CrossFrameStaticMethods?.imports
    const exported = imports?.grid
    if (exported !== undefined) {
      const returned = typeof exported === 'function' ? exported.call(imports) : exported
      const grid = await timed(() => Promise.resolve(returned), 4_000)
      if (grid === null || !['object', 'function'].includes(typeof grid)) {
        throw new Error('Grid export did not return an object')
      }
      const directFailures = []
      let usedRange
      try {
        usedRange = await timed(() => Promise.resolve(grid.usedRange), 4_000)
        if (typeof usedRange?.getValuesAsync === 'function') {
          const result = await readEwaRange('ewa-cross-frame-grid-usedRange', usedRange)
          return { ...result, gridMember: 'usedRange' }
        }
        directFailures.push('usedRange.getValuesAsync=' + typeof usedRange?.getValuesAsync)
      } catch (error) {
        directFailures.push('usedRange: ' + describe(error))
      }
      let sheets
      try {
        sheets = await timed(() => Promise.resolve(grid.mc?.sheets), 4_000)
        if (typeof sheets?.getItemByName === 'function') {
          const result = await readEwaSheets('ewa-cross-frame-grid-mc-sheets', sheets)
          return { ...result, gridMember: 'mc.sheets' }
        }
        directFailures.push('mc.sheets.getItemByName=' + typeof sheets?.getItemByName)
      } catch (error) {
        directFailures.push('mc.sheets: ' + describe(error))
      }
      const candidates = [{ name: 'grid', value: grid }]
      for (const name of Object.getOwnPropertyNames(grid).slice(0, 300)) {
        const descriptor = Object.getOwnPropertyDescriptor(grid, name)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
        const value = descriptor.value
        if (value !== null && ['object', 'function'].includes(typeof value)) {
          candidates.push({ name, value })
        }
      }
      const seen = new Set()
      const candidateFailures = []
      for (const candidate of candidates) {
        if (seen.has(candidate.value)) continue
        seen.add(candidate.value)
        try {
          let result
          if (typeof candidate.value.getActiveWorkbook === 'function') {
            result = await readEwaControl('ewa-cross-frame-grid', candidate.value)
          } else if (typeof candidate.value.getSheets === 'function') {
            result = await readEwaWorkbook('ewa-cross-frame-grid', candidate.value)
          } else continue
          return { ...result, gridMember: candidate.name }
        } catch (error) {
          if (candidateFailures.length < 3) {
            candidateFailures.push(candidate.name + ': ' + describe(error))
          }
          if (candidateFailures.length >= 3) break
        }
      }
      throw new Error(candidateFailures.length > 0
        ? 'Grid workbook candidates failed: ' + candidateFailures.join('; ')
        : directFailures.join('; ') + '; Grid has no EWA workbook method')
    }
  } catch (error) {
    failures.push('ewa-cross-frame-grid read failed: ' + describe(error))
  }

  if (typeof globalThis.Excel?.run === 'function') {
    try {
      return await timed(() => globalThis.Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem(sheetName)
        const range = sheet.getUsedRange(true)
        range.load('address,rowCount,columnCount')
        await context.sync()
        if (range.rowCount * range.columnCount > maxCells) {
          throw new Error('The used range exceeds the ' + String(maxCells) + '-cell read limit')
        }
        range.load('values,formulas')
        await context.sync()
        return packageValues('office-js', range.address, range.values, range.formulas)
      }), 12_000)
    } catch (error) {
      failures.push('Office JavaScript read failed: ' + describe(error))
    }
  }

  // Path: sheet model under grid.nGi (Sheet*) read cell-by-cell via its getCell method.
  try {
    const imports = globalThis._Ewa?.CrossFrameStaticMethods?.imports
    const grid = typeof imports?.grid === 'function' ? imports.grid() : null
    const nGi = grid?.nGi
    const modelName = nGi ? Object.keys(nGi).find(k => /^Sheet/.test(k)) : undefined
    const model = modelName ? nGi[modelName] : null
    if (model !== null && model !== undefined && typeof model.getCell === 'function') {
      if (!validBounds) throw new Error('used-range bounds are unavailable')
      if ((lastRow + 1) * (lastColumn + 1) > maxCells) {
        throw new Error('The used range exceeds the ' + String(maxCells) + '-cell read limit')
      }
      const colName = i => {
        let s = ''
        i += 1
        while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
        return s
      }
      const valueNames = ['value', 'text', 'displayValue', 'formattedValue', 'cellValue', 'v', 'result', 'data']
      const cellValue = cell => {
        if (cell === null || cell === undefined) return null
        if (typeof cell !== 'object') return cell
        const proto = Object.getPrototypeOf(cell)
        const names = Object.keys(cell)
        if (proto !== null) names.push(...Object.getOwnPropertyNames(proto))
        for (const n of valueNames) {
          if (!names.includes(n)) continue
          try {
            const v = cell[n]
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
          } catch { /* ignore accessor errors */ }
        }
        for (const n of names) {
          if (!/^get[a-z]/i.test(n)) continue
          try {
            const d = Object.getOwnPropertyDescriptor(cell, n)
              ?? (proto !== null ? Object.getOwnPropertyDescriptor(proto, n) : undefined)
            const fn = typeof d?.value === 'function' && d.value.length === 0 ? d.value
              : typeof cell[n] === 'function' && cell[n].length === 0 ? cell[n]
                : null
            if (fn === null) continue
            const v = fn.call(cell)
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
          } catch { /* ignore */ }
        }
        return null
      }
      // Detect the getCell calling convention: 'A1' address string vs numeric (row, col).
      let useAddress = false
      let zeroBased = false
      let cellSample = null
      const probeLog = []
      const resolveMaybe = v => (v !== null && typeof v === 'object' && typeof v.then === 'function')
        ? v.then(x => x, () => null)
        : v
      for (const args of [[], ['A1'], [1, 1], [0, 0], [0], [{ row: 1, column: 1 }]]) {
        try {
          let c = await resolveMaybe(model.getCell(...args))
          probeLog.push(JSON.stringify(args) + '=>' + (c === null || c === undefined ? String(c) : typeof c))
          if (c !== null && typeof c === 'object') {
            cellSample = c
            useAddress = typeof args[0] === 'string'
            zeroBased = args[0] === 0
            break
          }
        } catch (error) {
          probeLog.push(JSON.stringify(args) + '=>throw:' + describe(error).slice(0, 80))
        }
      }
      if (cellSample === null) throw new Error('sheet model getCell returned no cell object; probes: ' + probeLog.join(', '))
      const row0 = useAddress || !zeroBased ? 1 : 0
      const col0 = row0
      const values = []
      for (let r = row0; r < row0 + lastRow; r++) {
        const row = []
        for (let c = col0; c < col0 + lastColumn; c++) {
          let cell = null
          try {
            cell = useAddress ? model.getCell(colName(c - col0) + r) : model.getCell(r, c)
          } catch { cell = null }
          row.push(cellValue(cell))
        }
        values.push(row)
      }
      const sampleNames = Object.keys(cellSample)
      const sampleProto = Object.getPrototypeOf(cellSample)
      if (sampleProto !== null) sampleNames.push(...Object.getOwnPropertyNames(sampleProto))
      const result = packageValues('ewa-sheetmodel-getCell', 'A1:' + colName(lastColumn - 1) + lastRow, values, null)
      return { ...result, gridMember: modelName, cellMemberNames: sampleNames.slice(0, 80) }
    }
  } catch (error) {
    failures.push('ewa-sheetmodel-getCell read failed: ' + describe(error))
  }

  return { error: failures.length > 0 ? failures.join('; ')
    : 'No compatible EWA or Office JavaScript API is available in this frame; run dsh_browser_workbook_probe' }
}

/**
 * Runs inside an Office Online (WAC) frame: extract the WOPI source and access token from the
 * hidden workbook-context input. The result stays inside the extension process (service worker);
 * it is used only to fetch the file and is never forwarded to DSH or logged.
 */
function frameWopiContextPayload() {
  try {
    const el = document.querySelector('#m_excelWebRenderer_ewaCtl_m_workbookContextJson')
    if (el === null) return { error: 'No workbook context input found in this frame' }
    const ctx = JSON.parse(el.value)
    const params = new URLSearchParams(String(ctx.WorkbookUri ?? ''))
    const wopisrc = params.get('WOPIsrc')
    const token = params.get('access_token')
    if (wopisrc === null || token === null) return { error: 'The frame has no WOPI source or token' }
    return {
      wopisrc,
      token,
      sheetName: typeof ctx.ActiveSheetName === 'string' ? ctx.ActiveSheetName : 'Sheet1',
      restUrl: typeof ctx.FullDocumentInfo?.HostRestUrl === 'string' ? ctx.FullDocumentInfo.HostRestUrl : null,
      usid: new URL(location.href).searchParams.get('usid'),
    }
  } catch (error) {
    return { error: 'Failed to read the WOPI context: ' + String(error?.message ?? error) }
  }
}

/** Evaluate one expression inside a specific frame via chrome.scripting (covers cross-origin frames). */
async function evaluateInFrame(tabId, frameId, expression) {
  const payload = await runInFrame(tabId, frameId, frameEvalPayload, [expression])
  if (!isRecord(payload)) throw new Error('The frame returned no result')
  if (payload.ok !== true) throw new Error(String(payload.error ?? 'Frame evaluation failed'))
  const value = payload.value
  const serialized = JSON.stringify(value)
  if (serialized !== undefined && serialized.length > MAX_EVALUATION_RESULT_CHARS) {
    return { type: typeof value, valueText: serialized.slice(0, MAX_EVALUATION_RESULT_CHARS), truncated: true }
  }
  return { type: typeof value, value }
}

async function captureNetwork(params, signal) {
  const tabId = requireTabId(params.tabId)
  signal?.throwIfAborted()
  const durationMs = params.durationMs ?? 3_000
  const includeResponseBodies = params.includeResponseBodies === true
  const includeSensitiveData = params.includeSensitiveData === true
  const maxBodyChars = params.maxBodyChars ?? 5_000
  const maxRequestBodyChars = params.maxRequestBodyChars ?? 5_000
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_NETWORK_CAPTURE_MS) {
    throw new Error('durationMs must be an integer between 0 and ' + String(MAX_NETWORK_CAPTURE_MS))
  }
  if (params.includeResponseBodies !== undefined && typeof params.includeResponseBodies !== 'boolean') {
    throw new Error('includeResponseBodies must be a boolean')
  }
  if (params.includeSensitiveData !== undefined && typeof params.includeSensitiveData !== 'boolean') {
    throw new Error('includeSensitiveData must be a boolean')
  }
  if (!Number.isSafeInteger(maxBodyChars) || maxBodyChars < 1 || maxBodyChars > MAX_NETWORK_BODY_CHARS) {
    throw new Error('maxBodyChars must be an integer between 1 and ' + String(MAX_NETWORK_BODY_CHARS))
  }
  if (!Number.isSafeInteger(maxRequestBodyChars) || maxRequestBodyChars < 1 || maxRequestBodyChars > MAX_NETWORK_BODY_CHARS) {
    throw new Error('maxRequestBodyChars must be an integer between 1 and ' + String(MAX_NETWORK_BODY_CHARS))
  }

  let sequence
  if (params.steps !== undefined) {
    const settings = await getBehaviorSettings()
    sequence = normalizeSequenceCommand({
      tabId,
      steps: params.steps,
      interActionDelayMs: params.interActionDelayMs,
    }, settings.sequenceDelayMs)
  }

  return withDebugger(tabId, async target => {
    const requests = new Map()
    let truncated = false
    let requestBodiesIncluded = 0
    let requestBodiesLimited = false
    const onEvent = (source, method, eventParams = {}) => {
      if (source.tabId !== tabId) return
      if (method === 'Network.requestWillBeSent') {
        let request = requests.get(eventParams.requestId)
        if (request === undefined) {
          if (requests.size >= MAX_NETWORK_REQUESTS) {
            truncated = true
            return
          }
          request = { redirects: [], finished: false }
          requests.set(eventParams.requestId, request)
        }
        if (eventParams.redirectResponse) {
          request.redirects.push({
            url: redactNetworkUrl(eventParams.redirectResponse.url, includeSensitiveData),
            status: eventParams.redirectResponse.status,
          })
        }
        request.url = redactNetworkUrl(eventParams.request.url, includeSensitiveData)
        request.method = String(eventParams.request.method ?? '')
        request.resourceType = String(eventParams.type ?? '')
        request.initiatorType = String(eventParams.initiator?.type ?? '')
        request.startedAt = Number.isFinite(eventParams.wallTime)
          ? new Date(eventParams.wallTime * 1_000).toISOString()
          : undefined
        request.requestHeaders = redactNetworkHeaders(eventParams.request.headers, includeSensitiveData, request.url)
        request.hasPostData = eventParams.request.hasPostData === true
        if (includeSensitiveData && typeof eventParams.request.postData === 'string') {
          if (requestBodiesIncluded < MAX_NETWORK_RESPONSE_BODIES) {
            request.requestBody = eventParams.request.postData.slice(0, maxRequestBodyChars)
            request.requestBodyTruncated = eventParams.request.postData.length > maxRequestBodyChars
            requestBodiesIncluded++
          } else {
            requestBodiesLimited = true
          }
        }
      } else if (method === 'Network.requestWillBeSentExtraInfo') {
        const request = requests.get(eventParams.requestId)
        if (request) request.requestHeaders = redactNetworkHeaders(eventParams.headers, includeSensitiveData, request.url)
      } else if (method === 'Network.responseReceived') {
        const request = requests.get(eventParams.requestId)
        if (!request) return
        const response = eventParams.response ?? {}
        request.response = {
          url: redactNetworkUrl(response.url, includeSensitiveData),
          status: response.status,
          statusText: String(response.statusText ?? ''),
          mimeType: String(response.mimeType ?? ''),
          protocol: String(response.protocol ?? ''),
          timing: isRecord(response.timing) ? response.timing : undefined,
          fromCache: response.fromDiskCache === true || response.fromPrefetchCache === true,
          fromServiceWorker: response.fromServiceWorker === true,
          headers: redactNetworkHeaders(response.headers, includeSensitiveData, response.url),
        }
        if (request.pendingResponseExtraHeaders !== undefined) {
          request.response.extraHeaders = request.pendingResponseExtraHeaders
          delete request.pendingResponseExtraHeaders
        }
      } else if (method === 'Network.responseReceivedExtraInfo') {
        const request = requests.get(eventParams.requestId)
        if (request) {
          const extraHeaders = redactNetworkHeaders(eventParams.headers, includeSensitiveData, request.response?.url ?? request.url)
          if (request.response) request.response.extraHeaders = extraHeaders
          else request.pendingResponseExtraHeaders = extraHeaders
          if (request.response && eventParams.blockedCookies?.length) {
            request.response.blockedCookieCount = eventParams.blockedCookies.length
          }
        }
      } else if (method === 'Network.loadingFinished') {
        const request = requests.get(eventParams.requestId)
        if (request) {
          request.finished = true
          request.encodedDataLength = Number(eventParams.encodedDataLength) || 0
        }
      } else if (method === 'Network.loadingFailed') {
        const request = requests.get(eventParams.requestId)
        if (request) {
          request.failed = String(eventParams.errorText ?? 'Network request failed').slice(0, 300)
          request.cancelled = eventParams.canceled === true
        }
      }
    }

    chrome.debugger.onEvent.addListener(onEvent)
    try {
      await debuggerCommand(target, 'Network.enable', {
        maxTotalBufferSize: 2 * 1024 * 1024,
        maxResourceBufferSize: 256 * 1024,
        maxPostDataSize: MAX_NETWORK_BODY_CHARS,
      })
      const captureStartedAt = Date.now()
      let sequenceResult
      if (sequence !== undefined) {
        sequenceResult = await executeBrowserOperationNow('page.sequence', {
          tabId,
          steps: sequence.steps,
          interActionDelayMs: sequence.interActionDelayMs,
        }, signal)
      }
      if (durationMs > 0) await delay(durationMs, signal ?? new AbortController().signal)

      const bodyRecords = includeResponseBodies
        ? [...requests.entries()].filter(([, item]) => item.finished
          && item.encodedDataLength <= MAX_NETWORK_RESPONSE_BODY_BYTES
          && isTextNetworkMime(item.response?.mimeType))
          .slice(0, MAX_NETWORK_RESPONSE_BODIES)
        : []
      const eligibleResponseBodyCount = includeResponseBodies
        ? [...requests.values()].filter(item => item.finished
          && isTextNetworkMime(item.response?.mimeType)).length
        : 0
      const largeResponseBodiesSkipped = includeResponseBodies
        ? [...requests.values()].filter(item => item.finished
          && item.encodedDataLength > MAX_NETWORK_RESPONSE_BODY_BYTES
          && isTextNetworkMime(item.response?.mimeType)).length
        : 0
      if (includeSensitiveData) {
        const eligibleRequestBodyRecords = [...requests.entries()].filter(([, item]) => item.hasPostData && item.requestBody === undefined)
        const remainingRequestBodySlots = Math.max(0, MAX_NETWORK_RESPONSE_BODIES - requestBodiesIncluded)
        if (eligibleRequestBodyRecords.length > remainingRequestBodySlots) requestBodiesLimited = true
        const requestBodyRecords = eligibleRequestBodyRecords.slice(0, remainingRequestBodySlots)
        for (const [requestId, request] of requestBodyRecords) {
          signal?.throwIfAborted()
          try {
            const body = await debuggerCommand(target, 'Network.getRequestPostData', { requestId })
            const text = String(body.postData ?? '')
            request.requestBody = text.slice(0, maxRequestBodyChars)
            request.requestBodyTruncated = text.length > maxRequestBodyChars
            requestBodiesIncluded++
          } catch {
            request.requestBodyUnavailable = true
          }
        }
      }
      for (const [requestId, request] of bodyRecords) {
        signal?.throwIfAborted()
        try {
          const body = await debuggerCommand(target, 'Network.getResponseBody', { requestId })
          const text = body.base64Encoded === true ? decodeBase64Utf8(body.body) : String(body.body ?? '')
          request.responseBody = text.slice(0, maxBodyChars)
          request.responseBodyTruncated = text.length > maxBodyChars
        } catch {
          request.responseBodyUnavailable = true
        }
      }

      let cookies
      let cookieCount
      if (includeSensitiveData) {
        const cookieUrls = [...new Set([...requests.values()].map(item => item.url)
          .filter(url => typeof url === 'string' && /^https?:/i.test(url)))].slice(0, 50)
        if (cookieUrls.length > 0) {
          try {
            const cookieResult = await debuggerCommand(target, 'Network.getCookies', { urls: cookieUrls })
            const allCookies = Array.isArray(cookieResult.cookies) ? cookieResult.cookies : []
            cookieCount = allCookies.length
            cookies = allCookies.slice(0, MAX_NETWORK_COOKIES).map(cookie => ({
              name: cookie.name,
              value: String(cookie.value ?? '').slice(0, 4_096),
              valueTruncated: String(cookie.value ?? '').length > 4_096,
              domain: cookie.domain,
              path: cookie.path,
              expires: cookie.expires,
              httpOnly: cookie.httpOnly,
              secure: cookie.secure,
              sameSite: cookie.sameSite,
              sourceScheme: cookie.sourceScheme,
              partitionKey: cookie.partitionKey,
            }))
          } catch {
            cookies = []
            cookieCount = 0
          }
        } else {
          cookies = []
          cookieCount = 0
        }
      }

      const result = {
        tabId,
        capturedMs: Date.now() - captureStartedAt,
        sensitiveDataIncluded: includeSensitiveData,
        requestCount: requests.size,
        truncated,
        requests: [...requests.values()].map(({ finished, ...request }) => request),
      }
      if (cookies !== undefined) {
        result.cookies = cookies
        result.cookieCount = cookieCount
        if (cookieCount > cookies.length) result.cookiesTruncated = true
      }
      if (sequenceResult !== undefined) result.sequenceResult = sequenceResult
      if (eligibleResponseBodyCount > MAX_NETWORK_RESPONSE_BODIES) {
        result.responseBodiesLimited = MAX_NETWORK_RESPONSE_BODIES
      }
      if (largeResponseBodiesSkipped > 0) result.responseBodiesSkippedLarge = largeResponseBodiesSkipped
      if (requestBodiesLimited) result.requestBodiesLimited = MAX_NETWORK_RESPONSE_BODIES
      return result
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent)
      await debuggerCommand(target, 'Network.disable').catch(() => {})
    }
  })
}

function redactNetworkUrl(value, includeSensitiveData = false) {
  try {
    const url = new URL(String(value))
    if (includeSensitiveData) return url.href.slice(0, 2_048)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|passwd|auth|session|cookie|csrf|signature|credential|email/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    if (url.hash) url.hash = '#[REDACTED]'
    return url.href.slice(0, 2_048)
  } catch {
    return String(value).slice(0, 2_048)
  }
}

function redactNetworkHeaders(headers, includeSensitiveData = false, baseUrl = undefined) {
  if (!isRecord(headers)) return {}
  return Object.fromEntries(Object.entries(headers).slice(0, 100).map(([name, value]) => {
    const normalizedName = String(name).toLowerCase()
    let safeValue
    if (includeSensitiveData) safeValue = String(value).slice(0, 1_000)
    else if (normalizedName === ':path') safeValue = redactNetworkPath(value, baseUrl)
    else if (/authorization|cookie|token|secret|password|credential|api[-_]?key|session|csrf|signature|proxy-auth/i.test(normalizedName)) {
      safeValue = '[REDACTED]'
    } else safeValue = String(value).slice(0, 1_000)
    return [String(name).slice(0, 200), safeValue]
  }))
}

function redactNetworkPath(value, baseUrl) {
  try {
    const url = new URL(String(value), baseUrl)
    const safeUrl = new URL(redactNetworkUrl(url.href))
    return (safeUrl.pathname || '/') + safeUrl.search
  } catch {
    return String(value).slice(0, 1_000)
  }
}

function isTextNetworkMime(mimeType) {
  return typeof mimeType === 'string'
    && (/^(text\/|application\/(json|[^;]+\+json|xml|[^;]+\+xml|javascript|x-www-form-urlencoded))/i.test(mimeType))
}

async function captureConsole(params, signal) {
  const tabId = requireTabId(params.tabId)
  const durationMs = params.durationMs ?? 3_000
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_NETWORK_CAPTURE_MS) {
    throw new Error('durationMs must be an integer between 0 and ' + String(MAX_NETWORK_CAPTURE_MS))
  }
  let sequence
  if (params.steps !== undefined) {
    const settings = await getBehaviorSettings()
    sequence = normalizeSequenceCommand({
      tabId,
      steps: params.steps,
      interActionDelayMs: params.interActionDelayMs,
    }, settings.sequenceDelayMs)
  }
  signal?.throwIfAborted()
  return withDebugger(tabId, async target => {
    const entries = []
    let truncated = false
    const append = entry => {
      if (entries.length >= MAX_CONSOLE_ENTRIES) {
        truncated = true
        return
      }
      entries.push(entry)
    }
    const onEvent = (source, method, eventParams = {}) => {
      if (source.tabId !== tabId) return
      if (method === 'Runtime.consoleAPICalled') {
        const callFrames = eventParams.stackTrace?.callFrames ?? []
        append({
          kind: 'console',
          level: String(eventParams.type ?? 'log'),
          timestamp: Number.isFinite(eventParams.timestamp) ? eventParams.timestamp : undefined,
          url: String(callFrames[0]?.url ?? '').slice(0, 2_000),
          line: Number.isInteger(callFrames[0]?.lineNumber) ? callFrames[0].lineNumber + 1 : undefined,
          arguments: (eventParams.args ?? []).slice(0, 10).map(formatConsoleArgument),
          argumentsTruncated: (eventParams.args?.length ?? 0) > 10,
        })
      } else if (method === 'Runtime.exceptionThrown') {
        const details = eventParams.exceptionDetails ?? {}
        const exception = details.exception ?? {}
        append({
          kind: 'exception',
          level: 'error',
          text: String(exception.description ?? details.text ?? 'Uncaught page exception').slice(0, 2_000),
          url: String(details.url ?? '').slice(0, 2_000),
          line: Number.isInteger(details.lineNumber) ? details.lineNumber + 1 : undefined,
          column: Number.isInteger(details.columnNumber) ? details.columnNumber + 1 : undefined,
        })
      } else if (method === 'Log.entryAdded' && isRecord(eventParams.entry)) {
        const entry = eventParams.entry
        append({
          kind: 'browser-log',
          level: String(entry.level ?? 'info'),
          text: String(entry.text ?? '').slice(0, 2_000),
          source: String(entry.source ?? '').slice(0, 100),
          url: String(entry.url ?? '').slice(0, 2_000),
          line: Number.isInteger(entry.lineNumber) ? entry.lineNumber : undefined,
        })
      }
    }

    chrome.debugger.onEvent.addListener(onEvent)
    try {
      await debuggerCommand(target, 'Runtime.enable')
      await debuggerCommand(target, 'Log.enable').catch(() => {})
      const captureStartedAt = Date.now()
      let sequenceResult
      if (sequence !== undefined) {
        sequenceResult = await executeBrowserOperationNow('page.sequence', {
          tabId,
          steps: sequence.steps,
          interActionDelayMs: sequence.interActionDelayMs,
        }, signal)
      }
      if (durationMs > 0) await delay(durationMs, signal ?? new AbortController().signal)
      return {
        tabId,
        capturedMs: Date.now() - captureStartedAt,
        entryCount: entries.length,
        truncated,
        entries,
        ...(sequenceResult === undefined ? {} : { sequenceResult }),
      }
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent)
      await debuggerCommand(target, 'Log.disable').catch(() => {})
      await debuggerCommand(target, 'Runtime.disable').catch(() => {})
    }
  })
}

function formatConsoleArgument(argument) {
  const value = argument?.value
  if (typeof value === 'string') return value.slice(0, 1_000)
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value
  if (typeof argument?.unserializableValue === 'string') return argument.unserializableValue.slice(0, 1_000)
  return String(argument?.description ?? argument?.type ?? 'unknown').slice(0, 1_000)
}

function extractPage(params) {
  const tabId = requireTabId(params.tabId)
  const kind = params.kind
  if (!['tables', 'links', 'lists'].includes(kind)) throw new Error('kind must be tables, links, or lists')
  const selector = params.selector === undefined ? undefined : requireCssSelector(params.selector)
  const maxItems = params.maxItems ?? 50
  const maxChars = params.maxChars ?? 20_000
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > MAX_EXTRACT_ITEMS) {
    throw new Error('maxItems must be an integer between 1 and ' + String(MAX_EXTRACT_ITEMS))
  }
  if (!Number.isSafeInteger(maxChars) || maxChars < 100 || maxChars > MAX_EXTRACT_CHARS) {
    throw new Error('maxChars must be an integer between 100 and ' + String(MAX_EXTRACT_CHARS))
  }
  const expression = `(() => {
    const kind = ${JSON.stringify(kind)}
    const selector = ${JSON.stringify(selector ?? null)}
    const maxItems = ${maxItems}
    const maxChars = ${maxChars}
    const scope = selector === null ? document : document.querySelector(selector)
    if (!scope) throw new Error('The extraction selector did not match an element')
    const ownMatch = query => scope.nodeType === 1 && scope.matches(query) ? [scope] : []
    const nodes = query => [...ownMatch(query), ...scope.querySelectorAll(query)]
    const text = element => (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500)
    let items
    let totalFound
    if (kind === 'tables') {
      const rows = nodes('table').flatMap((table, tableIndex) => Array.from(table.rows, (row, rowIndex) => ({
        tableIndex,
        rowIndex,
        cells: Array.from(row.cells).slice(0, 30).map(cell => text(cell).slice(0, 300)),
      })))
      totalFound = rows.length
      items = rows.slice(0, maxItems)
    } else if (kind === 'links') {
      const links = nodes('a[href]').map(link => ({ text: text(link), href: link.href.slice(0, 2_048), title: (link.title || '').slice(0, 300) }))
      totalFound = links.length
      items = links.slice(0, maxItems)
    } else {
      const listItems = nodes('li').map((item, index) => ({
        index,
        depth: (() => { let depth = 0; let parent = item.parentElement?.closest('li'); while (parent) { depth++; parent = parent.parentElement?.closest('li') } return depth })(),
        text: text(item),
      }))
      totalFound = listItems.length
      items = listItems.slice(0, maxItems)
    }
    const result = { kind, selector, totalFound, items, truncated: totalFound > items.length }
    while (JSON.stringify(result).length > maxChars && result.items.length > 0) {
      result.items.pop()
      result.truncated = true
    }
    return result
  })()`
  return withDebugger(tabId, async target => {
    const response = await debuggerCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
    if (response.exceptionDetails !== undefined) {
      const detail = response.exceptionDetails.exception?.description
        ?? response.exceptionDetails.text ?? 'Page extraction failed'
      throw new Error(String(detail))
    }
    const result = response.result?.value
    if (!isRecord(result)) throw new Error('Chrome returned no structured extraction result')
    return { tabId, ...result }
  })
}

/**
 * Fetch one URL with a tab frame's session and return the bytes as base64.
 * The request runs inside the frame so it carries that page's cookies, origin,
 * and network path, and follows redirects under the page's own CORS rules.
 * When the page received a response it may not read (a cross-origin URL
 * without CORS), nothing more is fetched here: the result asks DSH for user
 * approval and carries a one-time token bound to this tab and URL, which
 * page.fetchFileRetry requires.
 */
async function fetchFileWithTabSession(params) {
  const tabId = requireTabId(params.tabId)
  const frameId = params.frameId === undefined ? 0 : requireFrameId(params.frameId)
  const url = downloadUrl(params.url)
  const payload = await runInFrame(tabId, frameId, fetchFileAsBase64, [url, MAX_FETCH_FILE_BYTES, 'page'])
  if (!isRecord(payload)) throw new Error('The tab returned no download result')
  if (payload.blockedByCors === true) {
    return { tabId, frameId, needsApproval: 'cors-retry', url, retryToken: issueFetchRetryToken(tabId, url) }
  }
  if (typeof payload.error === 'string') throw new Error(payload.error)
  return { tabId, frameId, ...payload }
}

/**
 * Run one user-approved credentialed fetch from the service worker. The token
 * must match the tab and the exact URL it was issued for, and is consumed
 * whatever happens. Redirects are not followed: a redirect returns its target
 * with a fresh token, so DSH can ask the user about that hop too.
 */
async function fetchFileApprovedRetry(params) {
  const tabId = requireTabId(params.tabId)
  const url = downloadUrl(params.url)
  consumeFetchRetryToken(params.retryToken, tabId, url)
  const redirects = []
  const requested = new URL(url).href
  const onBeforeRedirect = details => {
    if (details.tabId === -1 && details.initiator === self.location.origin) redirects.push(details)
  }
  const webRequest = chrome.webRequest
  webRequest?.onBeforeRedirect.addListener(onBeforeRedirect, { urls: ['http://*/*', 'https://*/*'], tabId: -1 })
  const findHop = () => redirects.findLast(details => details.url === requested)
  let payload
  try {
    payload = await fetchFileAsBase64(url, MAX_FETCH_FILE_BYTES, 'extension', 'manual')
    // The webRequest event can be dispatched after fetch() resolves.
    for (let waited = 0; payload?.redirected === true && findHop() === undefined && waited < 2_000; waited += 50) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  } finally {
    webRequest?.onBeforeRedirect.removeListener(onBeforeRedirect)
  }
  if (!isRecord(payload)) throw new Error('The extension returned no download result')
  if (payload.redirected === true) {
    const hop = findHop()
    if (hop === undefined || typeof hop.redirectUrl !== 'string') {
      throw new Error('The server redirected the download, but the extension could not read the redirect target. Reload the unpacked extension so it has the webRequest permission.')
    }
    let location
    try {
      location = downloadUrl(hop.redirectUrl)
    } catch (error) {
      throw new Error('The server redirected the download to an unsupported URL: ' + String(error?.message ?? error))
    }
    return { tabId, needsApproval: 'redirect', url, status: hop.statusCode, location, retryToken: issueFetchRetryToken(tabId, location) }
  }
  if (typeof payload.error === 'string') throw new Error(payload.error)
  return { tabId, frameId: 0, ...payload }
}

/** An HTTP(S) download URL without embedded credentials, normalized. */
function downloadUrl(value) {
  const url = httpUrl(value)
  const parsedUrl = new URL(url)
  if (parsedUrl.username || parsedUrl.password) throw new Error('Download URLs cannot contain embedded credentials')
  return parsedUrl.href
}

function issueFetchRetryToken(tabId, url) {
  const now = Date.now()
  for (const [token, entry] of fetchRetryTokens) {
    if (entry.expiresAt <= now) fetchRetryTokens.delete(token)
  }
  while (fetchRetryTokens.size >= MAX_FETCH_RETRY_TOKENS) {
    fetchRetryTokens.delete(fetchRetryTokens.keys().next().value)
  }
  const token = crypto.randomUUID()
  fetchRetryTokens.set(token, { tabId, url, expiresAt: now + FETCH_RETRY_TOKEN_TTL_MS })
  return token
}

function consumeFetchRetryToken(token, tabId, url) {
  const entry = typeof token === 'string' ? fetchRetryTokens.get(token) : undefined
  if (entry !== undefined) fetchRetryTokens.delete(token)
  if (entry === undefined || entry.expiresAt <= Date.now() || entry.tabId !== tabId || entry.url !== url) {
    throw new Error('This download retry was not offered by the extension for this tab and URL, or it expired. Run dsh_browser_save_file again.')
  }
}

/**
 * Fetch one URL and encode its body. Self-contained: it runs inside the tab
 * frame (via) 'page', and in the service worker as via 'extension'.
 * A page fetch that fails before any response is reported as CORS-blocked
 * only when a no-cors probe shows the server answered, so plain network
 * failures are reported instead of retried. With redirect 'manual', a
 * redirect answer is reported as { redirected: true } and not followed.
 */
async function fetchFileAsBase64(url, maxBytes, via, redirect = 'follow') {
  const requester = via === 'page' ? 'The page' : 'The extension'
  let response
  try {
    response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect })
  } catch (error) {
    if (via === 'page') {
      try {
        await fetch(url, { mode: 'no-cors', credentials: 'include', cache: 'no-store', redirect: 'follow' })
        return { blockedByCors: true }
      } catch {}
    }
    return { error: requester + ' could not fetch the URL: ' + String(error?.message ?? error) }
  }
  if (redirect === 'manual' && response.type === 'opaqueredirect') return { redirected: true }
  if (response.type === 'opaque' || response.type === 'opaqueredirect') {
    return via === 'page' ? { blockedByCors: true } : { error: requester + ' cannot read the response' }
  }
  if (!response.ok) return { error: requester + ' request failed with HTTP status ' + String(response.status) }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: 'The file is larger than the ' + String(maxBytes) + '-byte limit' }
  }
  const blob = await response.blob()
  if (blob.size > maxBytes) return { error: 'The file is larger than the ' + String(maxBytes) + '-byte limit' }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000))
  }
  return {
    via,
    finalUrl: response.url || url,
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    contentDisposition: response.headers.get('content-disposition') ?? '',
    bytes: bytes.length,
    base64: btoa(binary),
  }
}

async function startDownload(params) {
  const url = httpUrl(params.url)
  const parsedUrl = new URL(url)
  if (parsedUrl.username || parsedUrl.password) throw new Error('Download URLs cannot contain embedded credentials')
  const options = { url, saveAs: params.saveAs !== false }
  if (params.filename !== undefined) {
    if (typeof params.filename !== 'string' || params.filename.trim() === ''
      || params.filename.length > 255 || /[\\/:*?"<>|]/u.test(params.filename)
      || params.filename === '.' || params.filename === '..') {
      throw new Error('filename must be a simple file name without path separators')
    }
    options.filename = params.filename
  }
  const downloadId = await chrome.downloads.download(options)
  return getDownloadStatus(downloadId)
}

async function getDownloadStatus(downloadId) {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) throw new Error('downloadId must be a non-negative integer')
  const matches = await chrome.downloads.search({ id: downloadId })
  const item = matches[0]
  if (!item) throw new Error('No Chrome download matches that id')
  let filename = String(item.filename ?? '').split(/[\\/]/u).pop() ?? ''
  try { filename = decodeURIComponent(filename) } catch {}
  let origin = ''
  try { origin = new URL(item.url).origin } catch {}
  return {
    downloadId: item.id,
    state: item.state,
    filename,
    origin,
    bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes,
    paused: item.paused === true,
    canResume: item.canResume === true,
    danger: item.danger,
    error: item.error ?? item.interruptReason,
  }
}

async function debuggerCommand(target, method, params = {}) {
  const traceId = dragTraceByTab.get(target.tabId)
  if (traceId === undefined) return chrome.debugger.sendCommand(target, method, params)
  const startedAt = performance.now()
  logDragTrace(traceId, 'cdp-command-start', { method })
  try {
    const result = await chrome.debugger.sendCommand(target, method, params)
    logDragTrace(traceId, 'cdp-command-finished', { method, elapsedMs: Math.round(performance.now() - startedAt) })
    return result
  } catch (error) {
    logDragTrace(traceId, 'cdp-command-error', {
      method,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: String(error instanceof Error ? error.message : error).slice(0, 200),
    })
    throw error
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.remove(ELEMENT_NOTE_MENU_ID, () => {
    void chrome.runtime.lastError
    chrome.contextMenus.create({
      id: ELEMENT_NOTE_MENU_ID,
      title: 'DSH Note Mode',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    }, () => {
      if (chrome.runtime.lastError) console.warn('Could not register DSH Note Mode menu')
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ELEMENT_NOTE_MENU_ID || tab === undefined) return
  const useContextTarget = (info.frameId ?? 0) === 0 && (info.pageUrl === undefined || info.pageUrl === tab.url)
  void openElementNoteView(tab, 'pick', useContextTarget).catch(() => {
    console.warn('Could not open DSH Note Mode on this page')
  })
})

chrome.runtime.onStartup.addListener(() => {
  void readConnectionSettings().then(async settings => {
    if (!settings.autoConnect || !PAIRING_CODE_PATTERN.test(settings.pairingCode)) return
    await scheduleReconnect()
    await attemptAutoReconnect()
  }).catch(() => {})
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === RECONNECT_ALARM) {
    void restoreSession().then(() => attemptAutoReconnect()).catch(() => {})
    return
  }
  if (alarm.name !== KEEPALIVE_ALARM) return
  // Fires even when the service worker was suspended; resume polling if still paired.
  void restoreSession()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['DSH_NOTE_MODE', 'DSH_NOTE_LIST', 'DSH_NOTE_ALL', 'DSH_NOTE_SELECTED',
    'DSH_NOTE_OPEN_SAVED', 'DSH_NOTE_DELETE_SAVED', 'DSH_NOTE_EDITOR'].includes(message?.type)) {
    void handleElementNoteMessage(message, sender).then(sendResponse, error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    return true
  }
  if (message?.type === 'status') {
    void restoreSession().then(() => {
      sendResponse({ connected: activeSession !== undefined, origin: activeSession?.origin })
    })
    return true
  }
  if (message?.type === 'disconnect') {
    stopReconnect()
    void disconnect().then(() => sendResponse({ ok: true }), error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    return true
  }
  if (message?.type === 'pairAuto') {
    void (async () => {
      try {
        await restoreSession()
        if (activeSession === undefined) {
          const settings = await readConnectionSettings()
          if (!PAIRING_CODE_PATTERN.test(settings.pairingCode)) {
            throw new Error('Save the pairing code from DSH Web in extension Settings')
          }
          reconnectWanted = true
          if (settings.autoConnect) await scheduleReconnect()
          try { await attemptAutoReconnect() } finally {
            if (!settings.autoConnect) stopReconnect()
          }
        }
        sendResponse({ ok: activeSession !== undefined, origin: activeSession?.origin })
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
    return true
  }
  return false
})

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'DSH_CURSOR_ARRIVED' && Number.isInteger(message.moveSequence)) {
    const finish = cursorArrivals.get(message.moveSequence)
    if (finish !== undefined) finish()
  }
  return false
})

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.remove([noteDraftKey(tabId), noteViewKey(tabId)]).catch(() => {})
  overlayTabs.delete(tabId)
  activeDebuggerTargets.delete(tabId)
})
chrome.debugger.onDetach.addListener(source => {
  if (Number.isInteger(source.tabId)) activeDebuggerTargets.delete(source.tabId)
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined) overlayTabs.delete(tabId)
})

void restoreSession()

