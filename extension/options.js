import { DEFAULT_DSH_ORIGIN, normalizeDshOrigin } from './origin.js'

const SETTINGS_KEY = 'dshBrowserBehaviorSettings'
const CONNECTION_SETTINGS_KEY = 'dshBrowserConnectionSettings'
const PAIRING_SETTINGS_PATH = '/api/dsh-browser-extension/pairing'
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/u

const DEFAULTS = {
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
}

const GROUPS = [
  {
    title: 'Typing',
    fields: [
      ['baseFlightDelayMs', 'Base delay between keys', 'Base flight delay. Other timing variations adjust this value.', 0, 1000, 10, 'ms'],
      ['flightJitterMinFactor', 'Flight variation minimum', 'Lowest random multiplier applied to the base key delay.', 0.1, 2, 0.05, 'x'],
      ['flightJitterMaxFactor', 'Flight variation maximum', 'Highest random multiplier applied to the base key delay.', 0.1, 3, 0.05, 'x'],
      ['keyHoldMinMs', 'Key hold minimum', 'Minimum time a supported key stays down.', 0, 500, 10, 'ms'],
      ['keyHoldVariationMs', 'Additional key hold variation', 'Random amount added to the minimum key hold time.', 0, 500, 10, 'ms'],
      ['thinkingPauseChancePercent', 'Long pause chance', 'Chance per character of a longer pause.', 0, 25, 1, '%'],
      ['thinkingPauseMinMs', 'Long pause minimum', 'Shortest optional long pause.', 100, 5000, 50, 'ms'],
      ['thinkingPauseMaxMs', 'Long pause maximum', 'Longest optional long pause.', 100, 5000, 50, 'ms'],
      ['spacePauseMinFactor', 'Word and punctuation pause minimum', 'Minimum multiplier after spaces or punctuation.', 1, 8, 0.1, 'x'],
      ['spacePauseMaxFactor', 'Word and punctuation pause maximum', 'Maximum multiplier after spaces or punctuation.', 1, 10, 0.1, 'x'],
      ['commonBigramFactor', 'Common letter pair multiplier', 'Multiplier for common English letter pairs. Lower values shorten those pauses.', 0.1, 2, 0.05, 'x'],
      ['repeatedKeyFactor', 'Repeated key multiplier', 'Multiplier when the same character repeats.', 1, 4, 0.05, 'x'],
    ],
  },
  {
    title: 'Cursor animation',
    fields: [
      ['cursorSpeedPxPerMs', 'Cursor speed', 'Pixels per millisecond used to estimate animation duration.', 0.1, 5, 0.1, 'px/ms'],
      ['cursorMinDurationMs', 'Minimum cursor animation', 'Shortest cursor animation.', 50, 2000, 10, 'ms'],
      ['cursorMaxDurationMs', 'Maximum cursor animation', 'Longest cursor animation.', 50, 5000, 10, 'ms'],
      ['cursorArcRatio', 'Cursor arc size', 'How far the cursor path curves relative to travel distance.', 0, 0.6, 0.01, 'ratio'],
      ['cursorMaxArcPx', 'Cursor arc cap', 'Maximum sideways curve of the cursor path.', 0, 500, 10, 'px'],
      ['dragDurationMs', 'Default drag duration', 'Duration used by drag actions unless a tool call overrides it.', 100, 2000, 25, 'ms'],
    ],
  },
  {
    title: 'Sequence pacing',
    fields: [
      ['sequenceDelayMs', 'Delay between sequence actions', 'Pause between actions in dsh_browser_sequence unless the call overrides it.', 0, 1000, 10, 'ms'],
    ],
  },
]

const form = document.querySelector('#settings-form')
const connectionForm = document.querySelector('#connection-form')
const originInput = document.querySelector('#dsh-origin')
const pairingCodeInput = document.querySelector('#dsh-pairing-code')
const pairingPageNode = document.querySelector('#pairing-page-url')
const autoConnectInput = document.querySelector('#dsh-autoconnect')
const connectionStatusNode = document.querySelector('#connection-status')
const groupsNode = document.querySelector('#settings-groups')
const statusNode = document.querySelector('#status')
const resetButton = document.querySelector('#reset')
const inputs = new Map()
let savedPairingCode = ''

function makeField([key, title, description, min, max, step, unit]) {
  const wrapper = document.createElement('div')
  wrapper.className = 'setting'
  const inputId = 'setting-' + key
  const label = document.createElement('label')
  label.htmlFor = inputId
  label.textContent = title + ' (' + unit + ')'
  const input = document.createElement('input')
  input.id = inputId
  input.name = key
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.required = true
  const help = document.createElement('p')
  help.id = inputId + '-help'
  help.textContent = description + ' Range: ' + String(min) + ' to ' + String(max) + '.'
  input.setAttribute('aria-describedby', help.id)
  wrapper.append(label, input, help)
  inputs.set(key, input)
  return wrapper
}

for (const group of GROUPS) {
  const section = document.createElement('section')
  section.className = 'settings-group'
  const heading = document.createElement('h2')
  heading.textContent = group.title
  const grid = document.createElement('div')
  grid.className = 'settings-grid'
  for (const field of group.fields) grid.append(makeField(field))
  section.append(heading, grid)
  groupsNode.append(section)
}

function showStatus(message, isError = false) {
  statusNode.textContent = message
  statusNode.dataset.error = String(isError)
}

function populate(settings) {
  for (const [key, input] of inputs) {
    input.value = String(Number.isFinite(settings?.[key]) ? settings[key] : DEFAULTS[key])
    input.setCustomValidity('')
  }
}

function readInputs() {
  const settings = {}
  let valid = true
  for (const [key, input] of inputs) {
    input.setCustomValidity('')
    const value = input.valueAsNumber
    if (!Number.isFinite(value) || !input.checkValidity()) {
      valid = false
      input.reportValidity()
    }
    settings[key] = value
  }
  const orderChecks = [
    ['flightJitterMinFactor', 'flightJitterMaxFactor', 'Flight variation maximum must be at least its minimum.'],
    ['thinkingPauseMinMs', 'thinkingPauseMaxMs', 'Long pause maximum must be at least its minimum.'],
    ['spacePauseMinFactor', 'spacePauseMaxFactor', 'Word and punctuation pause maximum must be at least its minimum.'],
    ['cursorMinDurationMs', 'cursorMaxDurationMs', 'Cursor animation maximum must be at least its minimum.'],
  ]
  for (const [minKey, maxKey, message] of orderChecks) {
    if (settings[maxKey] < settings[minKey]) {
      const input = inputs.get(maxKey)
      input.setCustomValidity(message)
      input.reportValidity()
      valid = false
    }
  }
  return valid ? settings : undefined
}

async function initialize() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true)
    return
  }
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    populate({ ...DEFAULTS, ...(stored[SETTINGS_KEY] ?? {}) })
  } catch (error) {
    populate(DEFAULTS)
    showStatus(error instanceof Error ? error.message : String(error), true)
  }
  try {
    const connection = await chrome.storage.local.get(CONNECTION_SETTINGS_KEY)
    originInput.value = connection?.[CONNECTION_SETTINGS_KEY]?.origin ?? DEFAULT_DSH_ORIGIN
    const code = connection?.[CONNECTION_SETTINGS_KEY]?.pairingCode
    savedPairingCode = typeof code === 'string' ? code : ''
    pairingCodeInput.placeholder = savedPairingCode === '' ? 'Paste the code from DSH Web' : 'Saved code (leave blank to keep)'
    autoConnectInput.checked = connection?.[CONNECTION_SETTINGS_KEY]?.autoConnect !== false
  } catch {
    originInput.value = DEFAULT_DSH_ORIGIN
    savedPairingCode = ''
    autoConnectInput.checked = true
  }
  updatePairingPage()
}

/** Normalize the origin field; empty resets to the default. */
function readOrigin() {
  const raw = originInput.value.trim()
  return raw === '' ? DEFAULT_DSH_ORIGIN : normalizeDshOrigin(raw)
}

function updatePairingPage() {
  const origin = readOrigin()
  pairingPageNode.textContent = origin === undefined ? 'Enter a loopback or HTTPS address' : origin + PAIRING_SETTINGS_PATH
}

originInput.addEventListener('input', updatePairingPage)

connectionForm.addEventListener('submit', async event => {
  event.preventDefault()
  const origin = readOrigin()
  if (origin === undefined) {
    originInput.setCustomValidity('Enter a loopback address such as http://127.0.0.1:3080, or an HTTPS address such as https://dsh.example.com')
    originInput.reportValidity()
    return
  }
  originInput.setCustomValidity('')
  const pairingCode = pairingCodeInput.value.trim() || savedPairingCode
  if (pairingCode !== '' && !PAIRING_CODE_PATTERN.test(pairingCode)) {
    pairingCodeInput.setCustomValidity('Enter the 24-character pairing code shown in DSH Web')
    pairingCodeInput.reportValidity()
    return
  }
  pairingCodeInput.setCustomValidity('')
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    await chrome.storage.local.set({ [CONNECTION_SETTINGS_KEY]: { origin, pairingCode, autoConnect: autoConnectInput.checked } })
    savedPairingCode = pairingCode
    pairingCodeInput.value = ''
    pairingCodeInput.placeholder = pairingCode === '' ? 'Paste the code from DSH Web' : 'Saved code (leave blank to keep)'
    originInput.value = origin
    updatePairingPage()
    connectionStatusNode.textContent = pairingCode === ''
      ? 'Address saved. Add the pairing code to connect.'
      : 'Connection saved. Click Connect in the popup now. Automatic connection follows the checkbox above.'
    connectionStatusNode.dataset.error = 'false'
  } catch (error) {
    connectionStatusNode.textContent = error instanceof Error ? error.message : String(error)
    connectionStatusNode.dataset.error = 'true'
  }
})

form.addEventListener('submit', async event => {
  event.preventDefault()
  const settings = readInputs()
  if (settings === undefined) return
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
    showStatus('Settings saved. They take effect on the next browser action.')
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true)
  }
})

resetButton.addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULTS } })
    populate(DEFAULTS)
    showStatus('Restored the tested default settings.')
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true)
  }
})

void initialize()
