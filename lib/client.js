;(function () {
  const css = [
    '.dshChrome_section{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}',
    '.dshChrome_title{margin:0;font-size:18px;font-weight:600}',
    '.dshChrome_text{margin:0;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:13px;line-height:1.5}',
    '.dshChrome_fields{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:12px;row-gap:8px;align-items:center}',
    '.dshChrome_label{font-size:13px;font-weight:500}',
    '.dshChrome_copy{position:relative;min-width:0}',
    '.dshChrome_code{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font:13px var(--dsw-font-mono,monospace);cursor:copy;text-overflow:ellipsis}',
    '.dshChrome_code:focus-visible{outline:2px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));outline-offset:1px}',
    '.dshChrome_tip{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);padding:4px 8px;border-radius:6px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-tooltip-label);font-size:12px;line-height:16px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s;z-index:10}',
    '.dshChrome_copy:hover .dshChrome_tip,.dshChrome_copy:focus-within .dshChrome_tip,.dshChrome_tip[data-copied="true"]{opacity:1}',
    '.dshChrome_check{color:var(--dsw-alias-state-success-primary);font-weight:600;margin-right:4px}',
    '.dshChrome_actions{display:flex;gap:8px;align-items:center}',
    '.dshChrome_button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}',
    '.dshChrome_button:disabled{cursor:default;opacity:.5}',
    '.dshChrome_error{margin:0;color:var(--dsw-alias-label-error);font-size:13px}',
    '.dshChrome_notice{margin:0;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:13px}',
  ].join('')

  window.__ModuleLoader__.load({
    id: 'dsh-plugin-chrome-controller',
    factory: require => {
      const React = require('react')
      const h = React.createElement
      const path = '/api/dsh-browser-extension/pairing'
      const codePattern = /^[A-Za-z0-9_-]{24}$/u

      async function pairingRequest(method) {
        let response
        try {
          response = await fetch(path, {
            method,
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Could not reach DSH Web')
        }
        let body
        try { body = await response.json() } catch {
          throw new Error('DSH Web returned HTTP ' + String(response.status))
        }
        if (!response.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : 'DSH Web returned HTTP ' + String(response.status))
        }
        if (typeof body?.pairingCode !== 'string' || !codePattern.test(body.pairingCode)) {
          throw new Error('DSH Web returned an invalid pairing code')
        }
        return body.pairingCode
      }

      /** Copy text, falling back to a selection copy where the Clipboard API is unavailable (plain HTTP). */
      async function copyText(input) {
        const text = input.value
        if (navigator.clipboard?.writeText !== undefined && window.isSecureContext) {
          await navigator.clipboard.writeText(text)
          return
        }
        input.select()
        if (!document.execCommand('copy')) throw new Error('Copy failed')
      }

      /** Read-only value that copies itself on click, with a hover tooltip. */
      function CopyField({ id, value }) {
        const [state, setState] = React.useState('idle')
        const timer = React.useRef(undefined)
        React.useEffect(() => () => clearTimeout(timer.current), [])
        async function copy(event) {
          const input = event.currentTarget
          clearTimeout(timer.current)
          try {
            await copyText(input)
            setState('copied')
          } catch {
            input.select()
            setState('failed')
          }
          timer.current = setTimeout(() => setState('idle'), 1500)
        }
        const tip = state === 'copied'
          ? [h('span', { key: 'check', className: 'dshChrome_check', 'aria-hidden': true }, '\u2713'), 'Click to copy']
          : state === 'failed' ? 'Press Ctrl+C to copy' : 'Click to copy'
        return h('div', { className: 'dshChrome_copy' }, [
          h('input', { key: 'input', className: 'dshChrome_code', id, type: 'text', readOnly: true, value,
            'aria-describedby': id + '-tip', onClick: copy,
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copy(event) } } }),
          h('span', { key: 'tip', id: id + '-tip', className: 'dshChrome_tip', role: 'tooltip',
            'data-copied': state === 'copied' ? 'true' : undefined }, tip),
          h('span', { key: 'live', 'aria-live': 'polite',
            style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } },
          state === 'copied' ? 'Copied' : ''),
        ])
      }

      /** Chrome logo in the current text color, sized by the settings navigation. */
      function ChromeIcon({ size }) {
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
          h('circle', { key: 'outer', cx: 12, cy: 12, r: 9.25 }),
          h('circle', { key: 'inner', cx: 12, cy: 12, r: 3.5 }),
          h('path', { key: 'top', d: 'M12 8.5h8.6' }),
          h('path', { key: 'left', d: 'M8.97 13.75 4.66 6.3' }),
          h('path', { key: 'bottom', d: 'M15.03 13.75 10.73 21.2' }),
        ])
      }

      function ChromeBrowserSettings() {
        const [view, setView] = React.useState({ phase: 'loading', code: '', error: '', notice: '' })

        React.useEffect(() => {
          let active = true
          pairingRequest('GET').then(code => {
            if (active) setView({ phase: 'ready', code, error: '', notice: '' })
          }, error => {
            if (active) setView({ phase: 'error', code: '', error: String(error?.message ?? error), notice: '' })
          })
          return () => { active = false }
        }, [])

        async function reload() {
          setView({ phase: 'loading', code: '', error: '', notice: '' })
          try {
            const code = await pairingRequest('GET')
            setView({ phase: 'ready', code, error: '', notice: '' })
          } catch (error) {
            setView({ phase: 'error', code: '', error: String(error?.message ?? error), notice: '' })
          }
        }

        async function rotate() {
          setView(current => ({ ...current, phase: 'rotating', error: '', notice: '' }))
          try {
            const code = await pairingRequest('POST')
            setView({ phase: 'ready', code, error: '', notice: 'Code rotated. Save the new code in extension Settings to reconnect.' })
          } catch (error) {
            setView(current => ({ ...current, phase: current.code ? 'ready' : 'error',
              error: String(error?.message ?? error), notice: '' }))
          }
        }

        return h('section', { className: 'dshChrome_section' }, [
          h('h2', { key: 'title', className: 'dshChrome_title' }, 'Chrome browser pairing'),
          h('p', { key: 'intro', className: 'dshChrome_text' },
            'Copy this origin and code into the Chrome browser extension Settings page. After saving them, click Connect in the extension popup. Connect does not open a DSH tab.'),
          h('div', { key: 'fields', className: 'dshChrome_fields' }, [
            h('label', { key: 'origin-label', className: 'dshChrome_label', htmlFor: 'dsh-chrome-origin' }, 'DSH Web origin'),
            h(CopyField, { key: 'origin', id: 'dsh-chrome-origin', value: window.location.origin }),
            view.code
              ? h('label', { key: 'code-label', className: 'dshChrome_label', htmlFor: 'dsh-chrome-pairing-code' }, 'Pairing code')
              : null,
            view.code
              ? h(CopyField, { key: 'code', id: 'dsh-chrome-pairing-code', value: view.code })
              : null,
          ]),
          view.phase === 'loading'
            ? h('p', { key: 'loading', className: 'dshChrome_notice', role: 'status' }, 'Loading pairing code...')
            : null,
          view.error
            ? h('p', { key: 'error', className: 'dshChrome_error', role: 'alert' }, view.error)
            : null,
          h('p', { key: 'rotation-help', className: 'dshChrome_text' },
            'Rotating the code disconnects the current extension. Save the new code in extension Settings to connect again.'),
          h('div', { key: 'actions', className: 'dshChrome_actions' }, [
            h('button', { key: 'rotate', className: 'dshChrome_button', type: 'button',
              disabled: view.phase === 'loading' || view.phase === 'rotating', onClick: rotate },
            view.phase === 'rotating' ? 'Rotating...' : 'Rotate pairing code'),
            view.phase === 'error'
              ? h('button', { key: 'retry', className: 'dshChrome_button', type: 'button', onClick: reload }, 'Retry')
              : null,
          ]),
          view.notice
            ? h('p', { key: 'notice', className: 'dshChrome_notice', role: 'status' }, view.notice)
            : null,
        ])
      }

      return {
        name: 'dsh-plugin-chrome-controller',
        inject: ['slots'],
        apply(ctx) {
          // This loader does not consume `meta` stylesheets: own a <style> element for the plugin's lifetime.
          ctx.effect(() => {
            const style = document.createElement('style')
            style.setAttribute('data-plugin', 'dsh-plugin-chrome-controller')
            style.textContent = css
            document.head.append(style)
            return () => style.remove()
          }, 'dsh-plugin-chrome-controller: settings styles')
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'chrome-browser',
            order: 26,
            label: 'Chrome browser',
          }, ChromeBrowserSettings))
          ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: 'chrome-browser',
            label: 'Chrome browser',
          }, ChromeIcon))
        },
      }
    },
  })
})();
