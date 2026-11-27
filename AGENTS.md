# Reins — Orca plugin

Reins ties local task tracking to the agent session. While working, the agent records every
open topic, question, todo or doubt (especially ones the user must decide or do) as **todos**
in **groups**. The user sees and manages them in an Orca side panel.

Orca plugin docs (source of truth, read before changing manifest or host calls):
https://github.com/stablyai/orca/tree/main/docs/reference — start with `plugin-authoring.md`,
then `plugin-manifest.md`, `plugin-host-api.md`, `plugin-declarative-ui.md`.
Local Orca CLI: `orca` (1.4.264 at time of writing). `orca plugin types .` writes typings into
`.orca/types/`.

## Domain

- **Group**: `id`, `emoji`, `title`, `archived`, ordered child todos.
- **Todo**: `id`, `title`, `description` (markdown), `status: "open" | "closed"`, `archived`.
- Closing a todo never deletes it. Archiving hides a closed todo (or a whole group) from the
  default view. Delete exists only as an explicit user action in the UI.
- State is per Orca workspace (one worktree/folder = one board).

## Architecture

| Piece | Where | Why |
| --- | --- | --- |
| State file | `<workspace>/.reins/state.json` | The only channel the agent has: no MCP, no plugin CLI for installed plugins. Agent reads/edits it with its normal file tools. |
| Worker | `src/worker.ts` (`main`, `execution: "trusted-worker"`) | Needs Node `fs` to read/watch the state file and `workspace.list` (worker-only) to map workspace id → path. No hooks. |
| Panel | `src/panel.tsx` (`ui: "components"`) | Native Orca controls, light/dark for free, no CSS. Talks to worker via `plugin.request`, listens to worker posts. |
| Skill | `skills/track-reins/SKILL.md` | Agent instructions. See "Skill delivery". |

Data flow:
1. Panel subscribes to `workspace.changed`, asks worker `reins.get { workspaceId }`.
2. Worker resolves path, reads `.reins/state.json`, `fs.watch`es it, `orca.panels.post('reins.changed', state)` on change.
3. Panel edits → `plugin.request('reins.save', { workspaceId, rev, state })` (whole board) → worker
   refuses with `conflict` if the file's mtime ≠ `rev`, else writes atomically (tmp + rename).
4. Agent edits same file → watcher → panel updates.

Contract between panel and worker lives in `src/protocol.ts` (`declare module 'orca'` with
`PluginRequests` / `PluginPanelEvents`), included by both sides.

Capabilities: `workspace:read` only. Add nothing speculative —
every new capability re-prompts the user on update.

## Skill delivery (`track-reins`)

`contributes.skills` is **reserved and must stay empty** (manifest v2, Orca ≤1.4.264), so the
plugin cannot install the skill. Users install it themselves (README "Install the skill"):

1. `npx skills add lkostrowski/orca-plugin-reins --skill track-reins -g` — the community skills
   CLI (same one `orca skills install` uses) finds `skills/track-reins/` and links it into
   Claude Code, Codex and other agents. A skill alone loads on demand, not on every response.
2. For Claude, make it always-on: Orca's Claude default arguments (`agentDefaultArgs`) +=
   `--append-system-prompt-file <abs path>/SKILL.md`. Needs a file path: Orca's native chat
   refuses `$` and newlines in agent commands, so no `$(cat …)`. Use an absolute path.
   Only new conversations pick it up (Claude snapshots its system prompt per conversation).

Keep `SKILL.md` in agent-skill format (frontmatter `name`, `description`) so it keeps working
with the skills CLI and drops into `contributes.skills` once that ships. Later option: an
`agent.launch.before` hook appending the flag (restored sessions are not hooked).

Skill content must tell the agent, on **every response**:
1. Read `.reins/state.json` (create with `{ "version": 1, "groups": [] }` if missing).
2. Add todos for new open topics/questions/doubts/user decisions found during the work.
3. Close todos that got resolved; put todos into logical groups (emoji + title); create, rename,
   archive groups as context or user prompts dictate.
4. Never delete; never touch items the user archived unless asked.
5. Keep ids stable (short random strings); preserve unknown fields.

## Commands

```sh
orca plugin types .               # typings into .orca/types
orca plugin dev watch . --check   # load, stream logs, re-check each save
orca plugin validate .            # manifest + host-call check (run before commit)
orca plugin shot <plugin-key>     # PNG of the panel; read it to verify UI
orca plugin dev request . reins.get --data '{"workspaceId":"…"}'
orca plugin test .                # tests via orca/testing (mountWorker, panel kit)
```

`dev watch` in a non-TTY (agent) exits 3 on first load; re-run with the printed
`--approve <fingerprint>`. Never approve on the user's behalf without asking.

## Rules

- TypeScript, no build step (`.ts` worker, `.tsx` panel; needs `engines.orca >= 1.4.246`).
  Hooks need `>=1.4.248`. Set `engines.orca` to the newest `Since` used.
- Leave out `publisher`. `id`: `reins` (no `orca-` prefix — reserved).
- `orca/worker` is types-only: `import type`.
- Worker `activate` is the **default** export.
- Guard host methods newer than `engines.orca` with `orca.host.has(name)`.
- Panel components: no hooks, state in atoms, props plain JSON.
- Plugin folder: ≤2,000 files, ≤50 MiB; transpiled files ≤1 MiB each.
- Don't commit `.orca/`.

Board file is git-ignored by a `.reins/.gitignore` (`*`) the worker writes, so user repos stay untouched.

## Open questions

- Should the worker nudge agents that forget (e.g. on `agent.status.changed` → `done`, check the
  file's mtime)? Not planned until the system prompt proves insufficient.
- TODO: "send to agent" button that puts the quoted todo into the agent's prompt input (no Enter).
  Blocked: Orca has no host API for the native chat input. `terminal.sendText` (`terminal:send`)
  only reaches terminal agents, and needs `agent:read` + `agents.list` to find the terminal;
  tried and dropped. Revisit when Orca ships a chat-input API; copy button is the fallback.
