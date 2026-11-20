const statusNode = document.querySelector('#status')
const notesFeedback = document.querySelector('#notes-feedback')
const connectButton = document.querySelector('#connect')
const disconnectButton = document.querySelector('#disconnect')
const settingsButton = document.querySelector('#settings')
const noteModeButton = document.querySelector('#note-mode')
const pageNotesButton = document.querySelector('#page-notes')
const allNotesButton = document.querySelector('#all-notes')

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError
      if (error !== undefined) reject(new Error(error.message))
      else resolve(response)
    })
  })
}

function showStatus(text, connectedState = false, state = connectedState ? 'connected' : 'idle') {
  statusNode.textContent = text
  statusNode.dataset.state = state
  connectButton.hidden = connectedState
  disconnectButton.hidden = !connectedState
}

async function refreshStatus() {
  try {
    const result = await sendMessage({ type: 'status' })
    showStatus(result?.connected ? 'Connected to DSH Web' : 'Not connected', result?.connected === true)
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), false, 'error')
  }
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true
  showStatus('Connecting to DSH Web...', false, 'working')
  try {
    const result = await sendMessage({ type: 'pairAuto' })
    if (result?.ok !== true) throw new Error(result?.error ?? 'Connection failed (is DSH Web running at the address in Settings?)')
    showStatus('Connected to DSH Web', true)
    statusNode.title = result.origin ?? ''
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), false, 'error')
  } finally {
    connectButton.disabled = false
  }
})

disconnectButton.addEventListener('click', async () => {
  disconnectButton.disabled = true
  try {
    const result = await sendMessage({ type: 'disconnect' })
    if (result?.ok !== true) throw new Error(result?.error ?? 'Disconnect failed')
    showStatus('Disconnected')
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true, 'error')
  } finally {
    disconnectButton.disabled = false
  }
})

settingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

function openNoteView(button, type) {
  button.addEventListener('click', async () => {
    noteModeButton.disabled = true
    pageNotesButton.disabled = true
    allNotesButton.disabled = true
    notesFeedback.hidden = true
    try {
      const result = await sendMessage({ type, action: 'open' })
      if (result?.ok !== true) throw new Error(result?.error ?? 'Could not open the notes on this page')
      window.close()
    } catch (error) {
      notesFeedback.textContent = error instanceof Error ? error.message : String(error)
      notesFeedback.hidden = false
      noteModeButton.disabled = false
      pageNotesButton.disabled = false
      allNotesButton.disabled = false
    }
  })
}

openNoteView(noteModeButton, 'DSH_NOTE_MODE')
openNoteView(pageNotesButton, 'DSH_NOTE_LIST')
openNoteView(allNotesButton, 'DSH_NOTE_ALL')

async function initializeNoteEditor(params) {
  document.querySelector('#connection-panel').hidden = true
  document.querySelector('#note-editor').hidden = false
  document.title = 'Element note'
  const form = document.querySelector('#note-form')
  const field = document.querySelector('#note-text')
  const status = document.querySelector('#note-status')
  const save = document.querySelector('#note-save')
  const remove = document.querySelector('#note-remove')
  const cancel = document.querySelector('#note-cancel')
  const tabId = Number(params.get('noteTab'))
  const token = params.get('noteToken')

  async function request(action, note) {
    const result = await sendMessage({ type: 'DSH_NOTE_EDITOR', tabId, token, action, note })
    if (result?.ok !== true) throw new Error(result?.error ?? 'Could not access the note')
    return result
  }

  function showError(error) {
    status.textContent = error instanceof Error ? error.message : String(error)
  }

  async function finish(action, note) {
    save.disabled = true
    remove.disabled = true
    cancel.disabled = true
    try {
      await request(action, note)
      window.close()
    } catch (error) {
      showError(error)
      save.disabled = false
      remove.disabled = false
      cancel.disabled = false
    }
  }

  cancel.addEventListener('click', async () => {
    cancel.disabled = true
    await request('cancel').catch(() => {})
    window.close()
  })
  try {
    const result = await request('read')
    document.querySelector('#note-xpath').textContent = result.xpath
    field.value = result.note ?? ''
    remove.hidden = result.note === undefined
    save.disabled = false
    field.focus()
  } catch (error) {
    showError(error)
    field.disabled = true
    return
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    const note = field.value.trim()
    if (note === '') {
      status.textContent = 'Enter a note before saving.'
      return
    }
    void finish('save', note)
  })
  remove.addEventListener('click', () => { void finish('remove') })
}

async function initializeAllNotes() {
  document.querySelector('#connection-panel').hidden = true
  document.querySelector('#all-notes-panel').hidden = false
  document.title = 'All Notes'
  const filter = document.querySelector('#all-notes-filter')
  const list = document.querySelector('#all-notes-list')
  const status = document.querySelector('#all-notes-status')
  let groups = []
  let pending = false
  const drafts = new Map()

  async function request(action, entry, note) {
    const result = await sendMessage({
      type: 'DSH_NOTE_ALL', action, pageKey: entry?.pageKey, xpath: entry?.xpath, note,
    })
    if (result?.ok !== true) throw new Error(result?.error ?? 'Could not load notes')
    return result.notes
  }

  function applyFilter() {
    const query = filter.value.trim().toLowerCase()
    let count = 0
    for (const group of groups) {
      let visible = false
      for (const entry of group.rows) {
        const matched = entry.searchText.includes(query)
        entry.row.hidden = !matched
        if (matched) {
          visible = true
          count++
        }
      }
      group.section.hidden = !visible
    }
    status.textContent = count === 0
      ? (query === '' ? 'No saved notes.' : 'No matching notes.')
      : String(count) + (count === 1 ? ' note' : ' notes')
  }

  function makeButton(label) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    return button
  }

  function makeRow(entry) {
    const draftKey = entry.pageKey + ':' + entry.xpath
    const row = document.createElement('article')
    const url = entry.originalUrl ?? entry.pageUrl
    const source = document.createElement('p')
    source.className = 'note-source'
    if (entry.canOpen && url !== null) {
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = url
      source.append(link)
    } else if (url !== null) {
      source.textContent = entry.originalUrl === null ? url + ' (original address unavailable)' : url
    } else {
      source.textContent = 'Unknown page'
    }
    const content = document.createElement('p')
    content.className = 'note-content'
    content.textContent = entry.note
    const path = document.createElement('code')
    path.className = 'note-path'
    path.textContent = entry.xpath
    const actions = document.createElement('div')
    actions.className = 'note-actions'
    const edit = makeButton('Edit')
    const remove = makeButton('Delete')
    remove.title = 'Double-click within 200 ms to delete'
    const save = makeButton('Save')
    const cancel = makeButton('Cancel')
    const field = document.createElement('textarea')
    field.rows = 4
    field.maxLength = 2000
    field.setAttribute('aria-label', 'Note')
    actions.append(edit, remove, save, cancel)
    row.append(source, content, path, field, actions)

    function setEditing(editing, focus = false) {
      field.hidden = !editing
      save.hidden = !editing
      cancel.hidden = !editing
      edit.hidden = editing
      remove.hidden = editing
      content.hidden = editing
      if (editing) {
        field.value = drafts.get(draftKey) ?? entry.note
        if (focus) field.focus()
      }
    }

    async function update(action) {
      if (pending) return
      pending = true
      try {
        const notes = await request(action, entry, action === 'save' ? field.value : undefined)
        drafts.delete(draftKey)
        render(notes)
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        pending = false
      }
    }

    let lastClick
    remove.addEventListener('click', event => {
      if (!event.isTrusted || event.button !== 0 || event.detail === 0 || pending) return
      const elapsed = event.timeStamp - lastClick
      if (lastClick === undefined || elapsed < 0 || elapsed > 200) {
        lastClick = event.timeStamp
        return
      }
      lastClick = undefined
      void update('remove')
    })
    edit.addEventListener('click', () => setEditing(true, true))
    cancel.addEventListener('click', () => {
      drafts.delete(draftKey)
      setEditing(false)
    })
    save.addEventListener('click', () => { void update('save') })
    field.addEventListener('input', () => drafts.set(draftKey, field.value))
    setEditing(drafts.has(draftKey))
    return { row, searchText: ((url ?? 'unknown page') + ' ' + entry.note + ' ' + entry.xpath).toLowerCase() }
  }

  function render(notes) {
    const bySite = new Map()
    for (const entry of notes) {
      let group = bySite.get(entry.site)
      if (group === undefined) {
        const section = document.createElement('section')
        const heading = document.createElement('h2')
        heading.textContent = entry.site ?? 'Unknown site'
        section.append(heading)
        group = { section, rows: [] }
        bySite.set(entry.site, group)
      }
      const row = makeRow(entry)
      group.rows.push(row)
      group.section.append(row.row)
    }
    groups = [...bySite.values()]
    list.replaceChildren(...groups.map(group => group.section))
    applyFilter()
  }

  filter.addEventListener('input', applyFilter)
  try {
    render(await request('list'))
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
  }
}

const popupParams = new URLSearchParams(location.search)
if (popupParams.has('noteToken')) void initializeNoteEditor(popupParams)
else if (popupParams.get('allNotes') === '1') void initializeAllNotes()
else void refreshStatus()
