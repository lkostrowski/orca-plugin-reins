# Reins

An [Orca](https://github.com/stablyai/orca) plugin that keeps your coding agent on a short rein.

While the agent works, it records every open topic, question, todo and doubt, especially the
ones **you** have to decide or do, as todos in groups. You see them in a Reins side panel, and
you can close, edit, move and archive them there. Both of you edit the same file, so the board
stays in sync both ways.

## How it works

- Each Orca workspace (worktree or folder) has its own board at `<workspace>/.reins/state.json`.
- The agent reads and updates that file on every response, following the
  [`track-reins`](skills/track-reins/SKILL.md) instructions.
- The plugin's worker watches the file and pushes changes to the panel; edits made in the panel
  go back to the same file.
- `.reins/` ignores itself in Git (the plugin writes `.reins/.gitignore`), so your repo's own
  `.gitignore` stays untouched.

**Groups** have an emoji, a title and todos. **Todos** have a title, a markdown description and
are open or closed. Closed todos are kept, not deleted, and can be archived to hide them; groups
can be archived too.

## Install

```sh
orca plugin install lkostrowski/orca-plugin-reins
```

Reins runs a worker (`trusted-worker`) and asks for `workspace:read`: it needs to find each
workspace's folder and read and watch the board file there. Orca asks you to approve this on
install.

Open the **Reins** tab in Orca's right sidebar.

## Install the skill

The agent needs the [`track-reins`](skills/track-reins/SKILL.md) instructions. Orca plugins
cannot ship agent skills yet, so install them yourself.

**1. Install the skill** with the community skills CLI (works for Claude Code, Codex and other
agents):

```sh
npx skills add lkostrowski/orca-plugin-reins --skill track-reins -g
```

`-g` installs it for your user rather than one project; add `-a claude-code` (or another agent)
to pick agents without the prompt. `npx skills update` updates it later.

**2. Make it always on (Claude Code, recommended).** An installed skill loads only when the agent
decides it is relevant. To have Claude track the board on every response, also add the file to
its system prompt: in Orca's agent settings, add this to Claude's default arguments:

```
--append-system-prompt-file /Users/<you>/.claude/skills/track-reins/SKILL.md
```

Use the absolute path, to be safe. Only new conversations pick it up; resumed ones
keep the system prompt they started with.

**Without the skills CLI**, download the file anywhere and point the flag at it:

```sh
mkdir -p ~/.claude/skills/track-reins
curl -fsSL -o ~/.claude/skills/track-reins/SKILL.md \
  https://raw.githubusercontent.com/lkostrowski/orca-plugin-reins/main/skills/track-reins/SKILL.md
```

**Other agents** without a system-prompt flag: paste the contents of `SKILL.md` into their
global instructions (for Codex, `~/.codex/AGENTS.md`).

## Limits

- Local workspaces only; SSH and WSL workspaces are not supported yet.
- Order of todos and groups follows the file; the panel cannot reorder them yet.
- Descriptions are shown dimmed with line breaks, bullets and code; bold, italics and links
  show as plain text.

## Development

Needs Orca 1.4.248 or later. No build step: Orca transpiles the TypeScript.

```sh
orca plugin types .                 # typings into .orca/types
orca plugin dev load . --approve …  # load as local.reins (prints the fingerprint first)
orca plugin test .                  # worker and panel tests
orca plugin validate .
orca plugin shot local.reins        # PNG of the panel
```

Developing Reins inside its own repo reloads the plugin on every board write, because
`.reins/` sits inside the development folder Orca watches.

See [AGENTS.md](AGENTS.md) for the architecture and rules.

## License

Not chosen yet.
