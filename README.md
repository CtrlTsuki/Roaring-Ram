# R.R. (Roaring Ram)

A dark-mode desktop app that shows where your RAM goes and takes only the memory actions Windows
actually supports, telling you plainly what each one did and what it could not do.

| Part of the app | What it is |
| --- | --- |
| **Pulse** | Live memory: in use, usable and installed RAM, available, committed, the 5-minute average and peak, and a 5-minute chart. Updates every 2 s. |
| **Apps** | Running apps grouped by executable, ranked by private memory, with real app icons. **Titan** marks an app holding at least 10% of RAM (and at least 1 GB). |
| **Waterline** | Your system-wide RAM target (for example 10 GB of 16 GB). Measured against, never enforced. |
| **Seals** | Per-app memory limits in three strengths: Watch, Ceiling, Hard cap. Each shows whether Windows is really enforcing it. |
| **Titan** (action) | One-shot trim of a single app's working set, measured before and after. |
| **The Roaring** | One-shot, system-wide pass of supported reclamation, with a preview and confirmation first. |
| **Echoes** | A quiet activity log: time, action, measured change, and every limitation or refusal. |

## Run it

Requires Windows 10/11 x64 and Node 22 or later.

```bash
npm install
```

```bash
npm run dev
```

Other scripts: `npm test` (unit and Win32 integration tests), `npm run typecheck`, `npm run build`
then `npm start` (runs the built app). On first run, `npm run dev` downloads the Electron binary if
npm's install-script gate skipped it.

R.R. runs as a standard user and never asks for elevation. Run it as administrator only if you
want it to reach elevated apps; it still never touches Windows components.

**Stack:** Electron 45, React 19, TypeScript, electron-vite, and [koffi](https://koffi.dev) for direct
Win32 calls (no native compilation). Chosen because the folder was empty, Node was installed and Rust
was not, and koffi reaches every API below from a standard Node runtime.

## What Windows really lets a desktop app do

Everything below was tested on this machine against a real process (`tests/win32.test.ts`), not
just read from documentation.

### Monitoring (works for every process, no special rights)

- **System:** `GlobalMemoryStatusEx` (total, available, load) and `GetPerformanceInfo` (commit,
  cache, kernel pools); `GetPhysicallyInstalledSystemMemory` for installed RAM.
  "In use" = total minus available, and **available includes Windows' standby cache**, which is
  handed back the moment an app needs it.
- **Processes:** one `NtQuerySystemInformation(SystemProcessInformation)` call per tick reads
  private working set, working set and commit for every process without opening any of them,
  the same source Task Manager uses. Microsoft documents this call as subject to change.
- **Why the app list doesn't add up to "in use":** shared pages (DLLs, mapped files), the file
  cache, kernel pools and the compressed store aren't private to any app. R.R. ranks by private
  working set, which double-counts nothing, and says so in the list header.

### Control, by strength

| Mechanism | API | What it really does | Label in R.R. |
| --- | --- | --- | --- |
| Watch seal | none | R.R. compares and logs. Nothing is enforced. | Watching only |
| Trim (Titan, The Roaring) | `EmptyWorkingSet` | Moves pages out of the working set: unchanged pages to the standby list, changed ones to the modified list, which Windows writes to the page file (a short burst of disk activity). "In use" drops; pages fault back as the app touches them; **commit is unchanged**. | Measured before/after, plus a 30 s recheck |
| Ceiling seal | `SetProcessWorkingSetSizeEx` + `QUOTA_LIMITS_HARDWS_MAX_ENABLE` | Windows keeps **each process's** resident RAM at or under the value by paging out. The app slows down instead of failing. Per process, never a share of a total. Lifted when R.R. quits, applied again when it starts. | Enforced by Windows |
| Hard cap seal | Job object + `JOB_OBJECT_LIMIT_JOB_MEMORY` (with breakaway allowed) | Windows refuses commits beyond the cap across everything in the job. Allocations fail; many apps show errors or exit. Programs the app launches leave the job, unless the app places them in a job of its own (Node, Electron and Chromium apps do); R.R. lists those and counts their memory. Refused for the Windows shell. | Enforced by Windows (with a risk confirmation) |
| Ask to close | `PostMessage(WM_CLOSE)` | The same request as clicking an app's close button. The app decides; it may ask to save. | Disruptive: confirmed per app |

Access rules (Windows decides, R.R. reports): actions need `PROCESS_SET_QUOTA` (plus
`PROCESS_TERMINATE` for job assignment, a Windows requirement; R.R. never terminates). A standard user
gets these only for their own, non-elevated, non-protected processes. Everything else is shown as
"no access" and is only watched.

## What works, what is best-effort, what can't be enforced

**Works (OS-enforced or exact):**
- Live system and per-process figures; the 5-minute average and peak.
- Hard caps on apps you own: verified that allocations past the cap fail while the app stays alive.
- Ceilings on apps you own: verified the resident set stays at the ceiling under load.
- Asking an app to close (only when you choose it, and only the windows R.R. can reach).

**Best-effort:**
- **Titan and The Roaring.** The drop is real but temporary: apps pull back what they use. Every
  result shows the measured change, and a second measurement 30 s later shows how much came back.
- **The Waterline.** Windows has no system-wide cap. R.R. shows the gap, estimates the floor it
  can't influence (kernel pools plus processes it can't reach), and says when the target is out of reach.
- **Seals on new processes** apply only while R.R. is running. Closing the window with caps active asks
  whether to keep R.R. in the tray (the default), lift the caps, or quit and leave them.
- **Partial seals.** Some multi-process apps (browsers) put children in their own sandbox jobs;
  Windows may refuse to add those. R.R. reports "Partly enforced: 3 of 12".

**Cannot be enforced or done, at any privilege level:**
- Making an arbitrary app use or release less memory than it chooses to. No API rewrites another
  app's allocations, and memory can't be "divided proportionally" between apps.
- Taking a process back out of a job. Removing a cap lifts the limit; the empty job stays until the app exits.
- Changing a cap after R.R. quits. Windows drops the job's handle and R.R. can't reach it again, though
  the cap stays in force. R.R. asks before quitting: keep running in the tray, lift caps, or quit and keep them.
- Touching protected (PPL) or other users' processes as a standard user. Close requests to elevated
  windows are silently dropped by Windows (UIPI), so R.R. doesn't offer them.
- Purging the standby cache needs administrator rights, and it wouldn't lower "in use" anyway. R.R. doesn't do it.

**macOS and Linux:** the app runs, but monitoring only (`os` module + `ps`), with a banner saying so.
Linux cgroup v2 limits exist but only for apps launched inside a cgroup; that isn't wired up yet.

## Safety model

- Nothing disruptive runs without a preview and confirmation. Close requests are opt-in per app, none preselected.
- Never terminates a process, never elevates, never injects, never bypasses an access check.
- Windows components (`src/shared/windows-names.ts`) are never trimmed, limited or closed, even when running elevated.
- Trims and seals re-check the process's creation time, so a reused PID can't receive a seal meant for an
  exited app. Close requests go to windows found moments earlier and are not re-checked; the window
  handle itself, not the PID, is what receives them.
- A hard cap never captures programs the app launches by default (breakaway is allowed), and the Windows shell
  can't be capped or given a ceiling at all.
- The renderer is sandboxed with context isolation and a strict CSP. IPC accepts calls only from R.R.'s own
  window, and the main process checks the arguments of every action (kind, size, minimum, Windows components).

## Design notes

- **Visual system:** near-black cool ground, elevation by lightness, precise 1px lines, a single
  luminous "fountain" aqua used only on measured data. Gradients and glow appear only in the fountain.
  Instrument Serif for the name, the headline figure and the two rituals; Segoe UI Variable for
  everything read or operated.
- **The fountain:** memory in use is a dark column with a lit surface. The dashed line is the
  Waterline, the side tick the 5-minute average. It forms once on launch and when The Roaring
  begins, and otherwise moves only when Windows reports a new figure, so no animation can be mistaken
  for a result.
- **The blade:** a thin edge of light crosses confirm buttons for deliberate actions.
- **Echoes:** kind labels briefly resolve from scrambled glyphs when an entry first appears.
  Decorative only: values are never scrambled, and reduced motion turns it off.
- **Motion:** 140–280 ms, transform and opacity only, interruptible, all reduced-motion aware.
- **Lore** (see `reports/`) guided names and metaphors only; nothing from the game appears in the UI.
  In the released chapters, "the Roaring" is the prophesied catastrophe and sealing is how darkness is
  closed. That is why limits are **Seals**. The system-wide cleanup keeps the requested name **The
  Roaring**, which knowingly inverts the original meaning.

## Project map

```
src/main/win32.ts      Win32 bindings (koffi): snapshot, trim, ceiling, job caps, windows
src/main/platform.ts   Platform interface; Windows = full, macOS/Linux = monitoring only
src/main/engine.ts     Sampling, seal enforcement, The Roaring, Titan, Echoes
src/main/index.ts      Window, tray, quit flow, guarded IPC
src/shared/            Pure logic shared by both sides (units, history, apps, seals, waterline, cleanup)
src/renderer/src/      React UI (Pulse, Fountain, chart, Apps, drawer, dialogs, Echoes)
tests/                 Unit tests, Win32 integration tests, an Electron-runtime test, engine tests
scripts/make-icons.mjs Draws the app and tray icons
```

`RR_SHOTS=<folder> npx electron .` (development only) drives the window through its main states
and saves screenshots. It acts only on a test process it starts itself, uses a separate settings
folder, and previews The Roaring without running it.
