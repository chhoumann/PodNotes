---
name: verify-in-obsidian
description: >-
  Verify an Obsidian plugin change/fix actually works by driving the REAL Obsidian app in
  a dev vault via the `obsidian` CLI (eval / dev:console / dev:errors / dev:screenshot /
  command / plugin:reload) and asserting on persisted state — instead of trusting unit
  tests with mocks (jsdom can't load real Obsidian). Use when asked to verify/QA a fix,
  confirm a feature works end-to-end, check that something persists, reproduce a
  user-reported bug in the real app, or validate before merging — especially stateful UI
  (settings, modals, drag-reorder, lists). FIRST read the repo's AGENTS.md/CLAUDE.md for
  the vault name, plugin id, dev commands, and any QA matrix.
when_to_use: >-
  "verify this works", "QA the fix", "does it persist / save", "reproduce the bug in the
  real app", "check end-to-end before merge", "drive the GUI", "test in the dev vault".
---

# Verify Obsidian plugin changes in the real app

Vitest/jsdom can't load real Obsidian, so unit tests run against mocks/stubs — they **pass
while the real flow is broken**. For anything stateful (settings, modals, drag-reorder,
persistence), "the unit test passes" is necessary but **not sufficient**. Verify the real
app and assert on what actually persisted.

## Step 0 — read the repo's own guide first
`AGENTS.md` / `CLAUDE.md` hold the project specifics: **vault name, plugin id, dev-vault
path, build/test commands, and the QA matrix.** Use those, not guesses. Many Obsidian repos
already mandate CLI-verifiable development — follow it.

## The `obsidian` CLI (the house tool for this)
Anything you can do in Obsidian you can do from the CLI, including dev tools.

- **`vault=<name>` is a PREFIX argument**, always first: `obsidian vault=dev <command> …`.
  The suffix form (`obsidian <command> vault=dev`) can resolve to the wrong vault — don't use it.
- Useful commands: `plugin:reload id=<plugin>`, `command id=<commandId>`, `eval code=…`,
  `dev:debug on|off`, `dev:console`, `dev:errors`, `dev:screenshot`, `dev:dom`, `dev:css`,
  `dev:cdp`, `dev:mobile`, `devtools`, `tabs`, `workspace` (the repo's guide lists the full set).
- `dev:console` / `dev:errors` are only reliable while debugger capture is attached
  (`obsidian vault=dev dev:debug on`).
- For non-trivial `eval` code, pass it via a **heredoc/file to `code=…`** to avoid
  shell-quoting corruption.

## The loop (evidence-first)
1. **Rebuild** the bundle (watch: `bun run dev`; one-off per the repo's build script). Note the
   plugin `main.js` is often **symlinked** into the dev vault, so a rebuild updates it in place.
2. **Reload the plugin** — `obsidian vault=dev plugin:reload id=<plugin>`. A rebuilt `main.js`
   does NOT auto-reload in a running Obsidian. **This is the #1 false-negative**: never conclude
   a fix "doesn't work" without confirming the running app loaded the fresh build.
3. **Reproduce / seed** deterministic state (edit `data.json` or use the plugin's data API),
   then reload so it takes effect.
4. **Trigger** the behavior — `obsidian vault=dev command id=<…>`, or drive the UI via `eval`
   (see gotchas). Test BOTH hotkey and direct-command paths when relevant.
5. **Gather evidence** — `dev:debug on` → `dev:console clear`/`dev:errors clear` → act →
   `dev:console limit=200`, `dev:errors`, `dev:screenshot`, and `tabs`/`workspace ids` for layout.
6. **Assert on persisted state** — read the on-disk `data.json` (source of truth), not just the
   UI. Confirm it's plain JSON with no framework artifacts (e.g. Svelte `$state` Proxy leakage).
7. **Add/adjust a regression test** around a CLI-native seam so it's caught without manual
   steps. Structure code so Obsidian deps are injected behind interfaces; unit tests then swap
   in adapters / the obsidian stub for the pure logic.
8. **Clean up** — remove seeded data + temp files; `dev:debug off`.

## Evidence-first triage (for bug reports)
- **Don't assume the reported bug still exists** — it may have been fixed by unrelated changes.
  Confirm current behavior in the dev vault before touching code.
- **Reproduce under real user conditions**, not synthetic ones: the actual plugin settings,
  workspace/tab layout, and platform — and test BOTH the hotkey and direct-command
  (`command id=…`) paths.
- **Capture evidence before AND after** the action (`dev:console`, `dev:errors`,
  `dev:screenshot`, `tabs`, `workspace`). For pane/tab layout, `workspace … ids` is the
  authoritative evidence; `tabs` is a quick summary.
- **If you can't reproduce** after solid evidence-gathering, report the exact setup you tested
  and ask for a fresh issue with versions, config, and repro artifacts — don't guess-fix.

## Driving UI via `eval` — gotchas (apply to raw `eval` and obsidian-e2e alike)
- `eval` may **return before a long async body finishes**. Don't chain `await sleep(...)`
  inside one big eval and trust the return. Instead: **fast evals** (one DOM action + immediate
  return), and **sequence timing outside** (shell/Node `sleep` between calls).
- **Return JSON-serializable values** (a string), never a live DOM node/object.
- **Selectors:** reuse components' `aria-label`s — they're stable and intent-named.
- **Stacked modals:** query all matches, act on the **last** (topmost). Count `.modal-container`.
- **State pollutes across runs:** close leftovers first (click all `.modal-close-button`,
  close settings).
- **Read results reliably:** from a final UI-stable eval, or have the eval write to a vault
  file and read it from disk.

## Committed regression tests (`obsidian-e2e`, if available)
For flows worth guarding, port the check into the repo's e2e suite:
`createObsidianClient({ vault })`, a plugin handle, `acquireVaultRunLock`/`publishMarker` in
`beforeAll`, and `restoreData()` + lock release in `afterAll`. The handle exposes
`reload`, `data().patch(...)`, `exec(commandId, args)`, and `dev.eval(...)`.
**These are local-only** (CI has no Obsidian) — keep a CI-runnable unit/component test as the
primary guard and use the e2e test as the integration safety net.

## The two lessons worth internalizing
1. **Stale loaded code** is the most common false negative — reload the plugin before
   concluding anything about a fix.
2. **Verify the persisted state, not the UI** — and add the regression test against a
   CLI-native seam, because mock-based unit tests will happily pass on a broken real flow.
