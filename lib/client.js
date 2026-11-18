;(function () {
  const css = [
    '.dshChrome_section{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}',
    '.dshChrome_title{margin:0;font-size:18px;font-weight:600}',
    '.dshChrome_text{margin:0;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:13px;line-height:1.5}',
    '.dshChrome_field{display:flex;flex-direction:column;gap:5px}',
    '.dshChrome_label{font-size:12px;font-weight:500}',
    '.dshChrome_code{box-sizing:border-box;width:min(100%,360px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:9px 10px;font:13px var(--dsw-font-mono,monospace)}',
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
          h('div', { key: 'origin', className: 'dshChrome_field' }, [
            h('label', { key: 'label', className: 'dshChrome_label', htmlFor: 'dsh-chrome-origin' }, 'DSH Web origin'),
            h('input', { key: 'origin', className: 'dshChrome_code', id: 'dsh-chrome-origin',
              type: 'text', readOnly: true, value: window.location.origin,
              onFocus: event => event.currentTarget.select() }),
          ]),
          view.phase === 'loading'
            ? h('p', { key: 'loading', className: 'dshChrome_notice', role: 'status' }, 'Loading pairing code...')
            : null,
          view.error
            ? h('p', { key: 'error', className: 'dshChrome_error', role: 'alert' }, view.error)
            : null,
          view.code
            ? h('div', { key: 'field', className: 'dshChrome_field' }, [
              h('label', { key: 'label', className: 'dshChrome_label', htmlFor: 'dsh-chrome-pairing-code' }, 'Pairing code'),
              h('input', { key: 'code', className: 'dshChrome_code', id: 'dsh-chrome-pairing-code',
                type: 'text', readOnly: true, value: view.code,
                onFocus: event => event.currentTarget.select() }),
            ])
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
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'chrome-browser',
            order: 26,
            label: 'Chrome browser',
          }, ChromeBrowserSettings))
        },
      }
    },
    meta: () => ({ stylesheets: { 'lib/chrome-browser-settings.css': { text: () => css } } }),
  })
})();
