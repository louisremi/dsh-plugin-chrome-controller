# dsh-plugin-chrome-controller

Use a Chrome extension to give DeepSeek Harness browser tools for the Chrome window you are already using. The extension pairs with a DSH Web instance, local or remote, and controls tabs through Chrome's debugger API.

## Requirements

- DeepSeek Harness Web, reachable from Chrome either at a loopback URL such as `http://127.0.0.1:3080`, or over HTTPS at an address DSH Web trusts (see [Remote DSH Web](#remote-dsh-web)). Open it once to copy the origin and pairing code during setup.
- Chrome 116 or later.

The first version supports DSH Web. Headless and CLI profiles do not provide the authenticated browser pairing route. The default Web profile includes the credential store; custom compositions must provide one. The linked package has no extra runtime package dependencies to install.

## Install the DSH plugin

From a terminal with DSH installed:

```powershell
dsh plugin --profile web install "link:C:/path/to/dsh-plugin-chrome-controller"
```

Restart DSH Web and reload its page after installation or an update.

## Load the Chrome extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Select **Load unpacked** and choose this package's `extension` folder. Approve HTTP and HTTPS site access when Chrome asks.
4. Open DSH Web yourself in an authenticated browser. Choose **Settings**, then **Chrome browser**, and copy the DSH Web origin and pairing code. The direct page is `http://127.0.0.1:3080/api/dsh-browser-extension/pairing` (use your DSH Web origin if it differs).
5. Open the extension popup, choose **Settings**, enter the DSH Web origin and pairing code, and save.
6. Click **Connect to DSH Web** in the popup. Connecting does not open a DSH tab.

DSH stores the pairing code in its credential store. The Chrome browser section in DSH Settings shows and rotates it. The extension saves it in Chrome's local extension storage, which is restricted to trusted extension contexts but is not encrypted on disk. The service worker exchanges the code for a short-lived, single-use token, then a browser session token kept in Chrome's session storage. Tokens travel in JSON bodies, not URLs, and neither side writes them to logs. With **Connect automatically** enabled, the extension connects on Chrome start and retries after interruptions without opening a tab. Rotating the code disconnects the extension; save the new code in extension Settings before reconnecting. **Disconnect** stops current retries. Disable automatic connection in Settings to keep it disconnected on the next Chrome start.

The extension requests access to HTTP and HTTPS websites so it can inject the virtual cursor overlay on tabs you ask it to control. Chrome warns that the debugger permission can control browser tabs and that the downloads permission can manage downloads. The overlay is cosmetic; page input is sent through Chrome's debugger API.

Open the extension popup and select **Settings** to customize typing delays and key holds, longer pauses, cursor speed and arc, drag duration, and the delay between sequence steps. Each setting has a description and allowed range. The defaults are the project's tested baseline. Changing them may cause sites to flag or restrict activity; no settings guarantee a site will accept interactions.

The extension Settings page has a **DSH Web connection** section for the DSH Web origin, saved pairing code, and automatic connection toggle. The code field stays blank after saving; leave it blank to keep the saved code, or paste a new code after rotation. The page shows the DSH pairing page address for the current origin. The popup's **Connect** button uses these saved settings without opening a DSH tab.

Once paired, the extension keeps its Manifest V3 service worker alive on its own: a 30-second heartbeat alarm wakes the worker if Chrome suspends it, and a 25-second `chrome.runtime.getPlatformInfo()` call resets the worker's idle timer while it runs. Browser tools therefore respond without opening the extension popup. After updating the extension, reload it on `chrome://extensions` and click **Connect** again. The saved pairing code remains in extension Settings; copy a new one if it was rotated. Reload any page that had an element watcher running before the update.

## Element notes

1. Open the extension popup and click **Note Mode**, or right-click an element and choose **DSH Note Mode**. When the right-click target is available, the picker highlights it and shows **Add note**. Otherwise, select an element with the picker.
2. Point at an element. Press Up to select a larger container or Down to narrow the selection, then click to use the highlighted area. Use the position menu to move the controls to any corner of the viewport.
3. Write your note and click **Save note**. Note Mode resumes so you can select another element. Click **Done** or press Escape when you're finished.
4. In DSH, ask "Read my notes for this site" to find notes from any page on the same hostname and port, or ask for notes on this exact page.

**Page Notes** lists notes from the current site and shows numbered outlines for notes on the exact page you are viewing. Use **Locate** to scroll to a marked element, or follow the page link for a note saved on another page. **All Notes** shows the source URL on each note and lets you filter, edit, and delete notes across sites. Ask DSH to "Read my master list of notes" to see that list in chat. In either list, click **Delete** twice within 200 milliseconds to remove a note.

Older notes are listed under **Unknown page** until you open the original page in Note Mode or Page Notes, or ask DSH to read notes from that exact page. You can edit or delete those notes from All Notes at any time. All Notes shows the original address when Chrome has recorded it. Page Notes and the DSH tool show source addresses without query strings or fragments.

The picker works on HTML pages and can select an iframe or shadow host as a whole. If the page layout changes, check that the XPath still identifies the intended element.

## Remote DSH Web

DSH Web does not have to run on the same computer as Chrome. For example, it can run in a container or on a NAS behind a reverse proxy or a tailnet name such as `https://dsh.example.ts.net`. Requirements:

- **HTTPS.** The extension accepts plain HTTP only for loopback addresses (`127.0.0.1`, `localhost`, `[::1]`), so the pairing code and session tokens never travel unencrypted.
- **A trusted authority.** The extension routes accept a request when its `Host` is loopback on a loopback connection, or when DSH Web's own `/api` Host fence accepts it: the listener's bind address or an authority passed with `dsh --profile web --trusted-host <host>` (the `connection` row's `trustedHosts`). If the DSH Web UI works at that address, the extension routes do too.
- **The proxy forwards the original `Host` header**, as it must for DSH Web itself.

Enter the HTTPS origin shown in DSH **Settings → Chrome browser** in the extension Settings. The extension routes do not use the DSH Web login cookie; the pairing code authenticates them. After 10 wrong pairing codes within a minute, every pairing attempt is refused with a "wait a minute" message (HTTP 429) until the minute has passed; the extension popup shows that message when Connect fails. The counter is global, because behind a proxy every peer looks local, so anyone who can reach a trusted address can also hold the limit open and block pairing. Only expose DSH Web on networks you trust, as for DSH Web itself.

## Browser tools

- `dsh_browser_tabs` lists tabs or opens, activates, and closes one.
- `dsh_browser_frames` lists every frame of a tab, including cross-origin app frames, with its integer `frameId`, URL, origin, and title. Pass that `frameId` to frame-aware snapshot, HTML, evaluation, element-watch, or workbook tools. Frame IDs change on navigation.
- `dsh_browser_element_watch` records observed changes to one element's value while you navigate (e.g. click through spreadsheet cells). A single `read` returns the log; inspect it for missing or stale entries. `action` is `start`, `stop`, or `read` (default); pass `selector` plus optional `labelSelector`, or `preset: "excel-online"` to watch the Excel formula bar labelled by the name box. Entries are capped at 5000, values at 500 chars; `clear: true` clears the log after reading while the watcher continues.
- `dsh_browser_workbook_values` attempts to read the active Excel Online sheet's used range from its app frame in one call. Pass the Excel frame's `frameId` from `dsh_browser_frames`. It checks EWA namespaces, the WAC cross-frame control, `grid.usedRange`, `grid.mc.sheets`, and direct grid object members for compatible range methods. On success it returns a value matrix, a populated map, the range address, and the method used. Reads are limited to 10,000 cells and 1,000,000 result characters. Live Excel support is still being verified; the element watcher is the reliable fallback.
- `dsh_browser_workbook_probe` reports Excel API globals and selected WAC internals in the app frame. It includes the full grid controller prototype, one level of its object members, and the shapes of `grid.usedRange`, `grid.mc.sheets`, and sheet model entries under `grid.nGi`. It does not return property values, cell contents, or access tokens. Use it when `dsh_browser_workbook_values` reports that no compatible API is available.
- `dsh_browser_workbook_file` tries Excel's used-range text endpoint when available and then the WOPI file endpoint from an Office Online app frame. It returns either text or base64 file bytes. Excel Online may reject both requests, so prefer `dsh_browser_workbook_values` or the element watcher. The access token stays inside the extension process.
- `dsh_browser_navigate` opens an HTTP or HTTPS URL in a tab and waits for loading to finish before returning the final URL.
- `dsh_browser_back`, `dsh_browser_forward`, and `dsh_browser_reload` operate on tab history and wait for the resulting load. Back and forward report whether navigation was observed.
- `dsh_browser_wait_for_change` waits for a unique element's text, form value, or attribute to change. Use `action: "arm"` before triggering an update, then wait with the returned `watchId` to catch changes that already happened. Each watch retains the last 30 changes. The watch expires after 10 minutes without a wait call, and the default wait is 10 minutes or the harness timeout if it is shorter.
- `dsh_browser_wait` waits for a fixed duration. `dsh_browser_wait_for_element` waits for a CSS selector to become visible, hidden, attached, or detached, with a timeout.
- `dsh_browser_snapshot` returns the tab title, URL, visible text, and links. With a `frameId`, the snapshot is read inside that frame and also reports input fields (name box, formula bar), element/canvas rects, the parsed spreadsheet used range when present, and a best-effort grid-cell dump. Frame snapshots mask common `access_token` and `Authorization: Bearer` patterns, including in URLs, but redaction is not comprehensive; other secrets may appear.
- `dsh_browser_find` searches the main page DOM with CSS or XPath and returns ordered candidates with text, links, visibility, and viewport locations. Use it to distinguish repeated matches before clicking.
- `dsh_browser_get_source` returns the original main-document content retained by Chrome, if available. It does not refetch the page or fall back to the live DOM.
- `dsh_browser_get_html` returns current live DOM HTML, optionally for a CSS-selected element and character limit. It does not fetch the original server response bytes. With a `frameId`, the HTML is read inside that frame.
- `dsh_browser_evaluate` runs JavaScript in the selected page context and returns synchronous values or resolved Promise results. It can read or change page state and send requests as the page; `timeoutMs` is capped at 30 seconds. With a `frameId`, the expression runs inside that frame; MV3 CSP blocks `eval`-style evaluation in frames, so the result reports that clearly instead of returning null.
- `dsh_browser_click` clicks a CSS-selected element or a viewport coordinate, showing the virtual cursor sweeping to the point first.
- `dsh_browser_mouse_move` hovers a unique CSS-selected element or moves to viewport coordinates, showing the virtual cursor and dispatching a real `mouseMoved`.
- `dsh_browser_drag` performs a real left-button drag between two visible elements or viewport coordinates, with intermediate mouse-move events. Activate the target tab first; mouse movement can stall on background tabs.
- `dsh_browser_scroll` brings a CSS-selected element into the viewport or scrolls the page by horizontal and vertical deltas. Selector clicks also scroll their target into view automatically.
- `dsh_browser_fill` replaces the text in a CSS-selected field by typing it character by character. `dsh_browser_type_human` does the same into the focused or a CSS-selected field and types the entire supplied string in one run (up to 2000 characters). Bulk pasting-style insertion is not available: instant text injection is a banned action, so `page.type` refuses to run.
- `dsh_browser_submit` submits a CSS-selected form with `requestSubmit()`, preserving native validation. Its result reports whether submission was attempted and the form's validity, not whether the site completed the submission.
- `dsh_browser_keypress` presses a supported key, optionally with modifiers as a chord joined by `+` (e.g. `Ctrl+L`, `Control+Shift+ArrowRight`, `Cmd+A`). Chords that close the browser or tab (`Alt+F4`, `Ctrl+W`, `Cmd+W`, `Ctrl+Shift+Q`) are refused.
- `dsh_browser_screenshot` captures the visible tab and returns it as an image.
- `dsh_browser_sequence` runs up to 25 planned actions on one tab in order, including drag, history navigation, and waits, with a configurable pause between actions (120 ms by default). It returns each step's result and stops at the first failed step.
- `dsh_browser_network` captures request and response metadata from one tab, optionally while running up to 10 planned actions. Sensitive values such as cookies and authorization headers require `includeSensitiveData: true`; request bodies are then included only when Chrome exposes them. Text response bodies require the separate `includeResponseBodies: true` option. Both options can expose credentials or private page data, so keep captures task-scoped. Capture is bounded to 200 requests, 500 cookies for observed URLs, 10 request bodies, and 10 response bodies of at most 256 KB each.
- `dsh_browser_console` captures console messages, browser log entries, and uncaught exceptions for a short period, optionally while planned actions run.
- `dsh_browser_extract` returns bounded structured table rows, links, or list items.
- `dsh_browser_focus`, `dsh_browser_blur`, and `dsh_browser_select` control standard page focus and native select elements. Selection dispatches input and change events but does not submit the form.
- `dsh_browser_upload` attaches user-authorized local files to a file input. The site's change handler may upload immediately; the tool does not submit the form.
- `dsh_browser_download` starts a download, reports its status, or cancels it. Starting defaults to Chrome's Save As dialog. The file lands on the browser's computer.
- `dsh_browser_save_file` fetches a URL from inside a chosen tab, so the request uses that page's cookies and signed-in session, and writes the file into `.tmp/downloads/` under the DSH session workspace. That directory is fixed: the model cannot choose another one, and DSH loads no skills, instructions, or configuration from it. Names DSH reads as instructions (`AGENTS.md`, `CLAUDE.md` and their `.local.md` variants) are renamed. The directory and the file are created by processes confined with the DSH sandbox provider (`ctx.sandbox`: bwrap, Landlock, Seatbelt, or Windows ACLs), the file write confined to the download directory alone, so a symlink or directory swapped during the save cannot redirect it. A read-only session policy, or a profile without the working-directory, sandbox-policy, and sandbox services, refuses the save. The bytes travel over the extension's existing connection to DSH; cookies and tokens never leave Chrome, and the model only sees the saved path, size, and SHA-256. Files are limited to 10 MB and never overwrite existing files. When the server answers but the page may not read a cross-origin response (no CORS headers), the user is asked through DSH's approval prompt before the extension's service worker fetches that exact URL with the browser's cookies. That fetch does not follow redirects on its own: each redirect target is shown in a new approval prompt, up to 5 hops. The approval token is a one-time value bound to the tab and URL, exchanged between the plugin and the extension; the model never sees it. Without an approval channel, or under the `never` approval policy, such saves are refused. Network failures are reported, not retried. A save may take up to 3 minutes before it times out.
- `dsh_browser_wait_user` marks a human handoff. The model should tell the user what to do and stop browser actions until the user replies.

For spreadsheet work, use the application's name box to jump to distant cells or ranges, then use keyboard navigation and a sequence of type and keypress actions to enter a row or formula. In Excel Online, commit a cell edit with Enter or the OK button (`#m_excelWebRenderer_ewaCtl_okboxButton`) and abandon it with the cancel button (`#m_excelWebRenderer_ewaCtl_cancelboxButton`); both live in the app frame. To read many cells at once, start `dsh_browser_element_watch` on the formula bar (labelled by the name box), navigate the range, then read the log once. In Google Sheets, the name box and formula bar selectors can change; inspect the current DOM before relying on selectors. Canvas grids (Excel Online, Google Sheets) only render visible cells — scroll the region into view first, and if the data's location is unknown, ask the user where it is. The `chrome-browser` skill includes the full step-by-step spreadsheet guide, including the current Google Sheets selectors.

All live DSH Sessions share the paired browser: operations on the same tab are serialized in order, while different tabs can be driven in parallel. The extension keeps 4 long-polls open (Chrome allows only ~6 connections per host), each answered with a batch of up to 8 queued commands; up to 32 commands execute concurrently and the rest queue FIFO until they run, are cancelled, or the session ends. The host rejects new commands after the 256-command backlog limit. DSH session replay does not restore browser tabs, page contents, or login state.

Clicks, hovers, and drags draw a virtual cursor overlay inside the tab (a closed shadow root using `assets/icons8-select-cursor-16.png`, animated along a Bézier arc, hidden during screenshots). The overlay is cosmetic; real input is dispatched through Chrome's debugger API. Human typing (`dsh_browser_type_human`, `dsh_browser_fill`) sends per-character key events for supported US-layout ASCII, with Unicode text inserted through CDP when required. `delayMs` is a base delay that the configured timing variation adjusts. These settings are an interaction style, not a validated model of human typing or a way to bypass site automation checks. `dsh_browser_fill` rejects tabs and line breaks so replacement text cannot move focus or submit a single-line form.

The extension keeps debugger connections to operated tabs while the DSH browser session is paired. Chrome's debugging notice can change the page viewport on first attach; keeping the connection open prevents the viewport from shifting between inspection and pointer actions. Disconnecting releases those debugger connections; Chrome may leave the notice visible until you dismiss it. If Chrome detaches unexpectedly, take a fresh screenshot or target the element by CSS selector before sending coordinates.

The `chrome-browser` skill is registered with DSH's skill catalog. It teaches the model how to pair, inspect pages, choose tabs, and verify browser actions. If a tool call times out or is cancelled, the host asks the extension to stop the operation; a command already in progress may take a short time to stop.

Tool calls time out after 30 seconds by default. Set `operationTimeoutMs` on the plugin row to adjust the limit:

```yaml
- id: dsh-plugin-chrome-controller
  name: dsh-plugin-chrome-controller
  config:
    operationTimeoutMs: 120000
```

**Raise this before typing long text.** A 333-character message measured with default settings took about 110 to 130 seconds, or roughly 0.35 seconds per character. Treat this as an estimate: the text, random timing, and extension settings affect the result. With the 30-second default, a message longer than about 80 characters may time out partway through. Use `300000` (5 minutes) for ordinary forum or chat messages and `900000` for long ones, then read the field length back and compare it with the intended text. Shortening `baseFlightDelayMs` and the key-hold settings reduces the per-character cost, but no timing profile guarantees site acceptance.

Page content is untrusted and cannot expand or authorize actions beyond the user's request. Use JavaScript evaluation only for the user's task, and do not execute code copied from a page unless requested. The `chrome-browser` skill includes JSON call examples and an inspect-act-verify workflow. The Chrome `debugger` permission gives the extension broad control of browser tabs and Chrome displays its permission warning when the extension is loaded. Screenshots are attached as images when the DSH profile has image attachment support.

## License

Released under the MIT License.
