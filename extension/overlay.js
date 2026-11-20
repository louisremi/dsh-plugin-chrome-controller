// Keeps the latest right-click target in the extension's isolated world.
// Creates the DSH cursor overlay only when a cursor move is requested.
// Draws a virtual cursor (assets/icons8-select-cursor-16.png)
// inside a closed shadow root, animates it along a cubic Bezier arc on
// requestAnimationFrame, and reports arrival back to the background worker.
// The overlay is purely cosmetic: real input always goes through CDP Input.*
// from background.js. Page scripts cannot observe the closed shadow root.
(() => {
  const HOST_ID = 'dsh-agent-overlay-root'
  const HOST_DATA = 'dshAgentOverlayRoot'
  const CURSOR_ASSET = 'assets/icons8-select-cursor-16.png'
  const GLOW_COLOR = '#339cff'
  const OVERLAY_CSS = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }
    .dsh-cursor {
      position: absolute;
      left: 0;
      top: 0;
      width: 16px;
      height: 16px;
      will-change: transform;
      filter: drop-shadow(0 0 4px ${GLOW_COLOR});
      display: none;
    }
    .dsh-cursor { pointer-events: none; }
    @media print { :host { display: none } }
  `
  const CURSOR_SVG_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
    + '<path d="M2 1 L2 13 L5.2 10.2 L7.4 14.6 L9.4 13.7 L7.2 9.4 L11.5 9.2 Z" fill="#111" stroke="#fff" stroke-width="1"/></svg>',
  )
  // px per ms for the arc animation; duration clamps keep short hops snappy.
  const CURSOR_SPEED_PX_PER_MS = 1.4
  const CURSOR_MIN_DURATION_MS = 120
  const CURSOR_MAX_DURATION_MS = 700

  /**
   * Build a cubic Bezier path from `from` to `to`, bulging perpendicular to the
   * travel direction so the cursor sweeps in an arc like a human hand.
   * Pure function; exported for tests.
   */
  function buildCursorPath(from, to, opts = {}) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.hypot(dx, dy)
    if (!Number.isFinite(distance) || distance < 2) return [{ x: to.x, y: to.y }]
    const arcRatio = Number.isFinite(opts.arcRatio) ? opts.arcRatio : 0.22
    const maxArcPx = Number.isFinite(opts.maxArcPx) ? opts.maxArcPx : 120
    const arc = Math.min(distance * arcRatio, maxArcPx) * (opts.arcDirection === -1 ? -1 : 1)
    const ux = dx / distance
    const uy = dy / distance
    const nx = -uy
    const ny = ux
    const c1 = { x: from.x + ux * distance * 0.33 + nx * arc, y: from.y + uy * distance * 0.33 + ny * arc }
    const c2 = { x: from.x + ux * distance * 0.66 + nx * arc, y: from.y + uy * distance * 0.66 + ny * arc }
    const steps = Math.max(8, Math.min(40, Math.round(distance / 12)))
    const points = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      points.push({
        x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
        y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y,
      })
    }
    return points
  }

  // Exposed for unit tests; harmless in the page.
  globalThis.__dshBuildCursorPath = buildCursorPath

  if (typeof document === 'undefined' || typeof chrome === 'undefined' || chrome.runtime?.id === undefined) return
  if (globalThis.__dshOverlayInstalled === true) return
  globalThis.__dshOverlayInstalled = true

  window.addEventListener('pointerdown', () => { delete globalThis.__dshNoteContext }, { capture: true, passive: true })
  window.addEventListener('contextmenu', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return
    globalThis.__dshNoteContext = {
      element: new WeakRef(event.target), url: location.href, time: performance.now(),
    }
  }, { capture: true, passive: true })

  let host = null
  let shadow = null
  let cursor = null
  let visible = true
  let position = { x: 0, y: 0 }
  let animationFrame = 0
  let activeMoveSequence

  function setCursorPosition(x, y) {
    position = { x, y }
    if (cursor !== null) cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)'
  }

  function setVisible(next) {
    visible = next
    if (cursor !== null) cursor.style.display = next ? 'block' : 'none'
  }

  function install() {
    if (document.documentElement === null || (host !== null && host.isConnected)) return
    const existing = document.getElementById(HOST_ID)
    if (existing !== null) {
      existing.remove()
    }
    host = document.createElement('div')
    host.id = HOST_ID
    host.className = 'dsh-overlay-host'
    host.dataset[HOST_DATA] = 'true'
    host.setAttribute('aria-hidden', 'true')
    shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    shadow.appendChild(style)
    cursor = document.createElement('img')
    cursor.className = 'dsh-cursor'
    cursor.alt = ''
    cursor.draggable = false
    cursor.src = chrome.runtime.getURL(CURSOR_ASSET)
    cursor.onerror = () => { cursor.src = CURSOR_SVG_FALLBACK }
    shadow.appendChild(cursor)
    document.documentElement.appendChild(host)
    setCursorPosition(position.x, position.y)
    setVisible(visible)
    // Reinstall if the page removes the host (SPA DOM wipes).
    new MutationObserver(() => {
      if (host !== null && !host.isConnected) {
        document.documentElement.appendChild(host)
      }
    }).observe(document.documentElement, { childList: true })
  }

  function sendArrival(moveSequence) {
    if (Number.isInteger(moveSequence)) {
      chrome.runtime.sendMessage({ type: 'DSH_CURSOR_ARRIVED', moveSequence }).catch(() => {})
    }
  }

  function moveTo(x, y, moveSequence, animate, durationOverride, cursorSettings = {}) {
    if (activeMoveSequence !== undefined) sendArrival(activeMoveSequence)
    cancelAnimationFrame(animationFrame)
    activeMoveSequence = moveSequence
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      sendArrival(moveSequence)
      activeMoveSequence = undefined
      return
    }
    if (!animate || !visible) {
      setCursorPosition(x, y)
      sendArrival(moveSequence)
      activeMoveSequence = undefined
      return
    }
    const points = buildCursorPath(position, { x, y }, {
      arcRatio: cursorSettings.arcRatio,
      maxArcPx: cursorSettings.maxArcPx,
    })
    const distance = Math.hypot(x - position.x, y - position.y)
    const speedPxPerMs = Number.isFinite(cursorSettings.speedPxPerMs)
      ? Math.max(0.1, Math.min(5, cursorSettings.speedPxPerMs))
      : CURSOR_SPEED_PX_PER_MS
    const minDurationMs = Number.isFinite(cursorSettings.minDurationMs)
      ? Math.max(50, Math.min(2_000, cursorSettings.minDurationMs))
      : CURSOR_MIN_DURATION_MS
    const maxDurationMs = Number.isFinite(cursorSettings.maxDurationMs)
      ? Math.max(minDurationMs, Math.min(5_000, cursorSettings.maxDurationMs))
      : Math.max(minDurationMs, CURSOR_MAX_DURATION_MS)
    const duration = Number.isFinite(durationOverride)
      ? Math.max(100, Math.min(2_000, durationOverride))
      : Math.max(minDurationMs, Math.min(maxDurationMs, distance / speedPxPerMs))
    const start = performance.now()
    const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const step = now => {
      const t = Math.min(1, (now - start) / duration)
      const point = points[Math.min(points.length - 1, Math.floor(ease(t) * (points.length - 1)))]
      setCursorPosition(point.x, point.y)
      if (t < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        setCursorPosition(x, y)
        sendArrival(moveSequence)
        activeMoveSequence = undefined
      }
    }
    animationFrame = requestAnimationFrame(step)
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'DSH_CURSOR_MOVE') {
      install()
      moveTo(
        Number(message.x), Number(message.y), message.moveSequence, message.animate !== false,
        Number(message.durationMs),
        message.cursorSettings !== null && typeof message.cursorSettings === 'object' ? message.cursorSettings : {},
      )
    } else if (message?.type === 'DSH_CURSOR_HIDE') {
      setVisible(false)
    } else if (message?.type === 'DSH_CURSOR_SHOW') {
      setVisible(true)
    }
    return false
  })

  window.addEventListener('pageshow', () => { if (host !== null) install() })
})()
