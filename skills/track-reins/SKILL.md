---
name: track-reins
description: Track every open topic, question, todo and doubt of the current work in the workspace's Reins board (.reins/state.json). Use on every response while working in an Orca workspace.
---

# Track reins

The Orca workspace has a Reins board at `<workspace root>/.reins/state.json`. The user watches
it in Orca's Reins panel, which reads exactly that file. Keep it current.

## Find the file once per session

The workspace root is the Orca workspace's folder (a worktree root, or the opened folder), not
a subfolder you moved into and not the main checkout of a worktree. Resolve it once:

```sh
orca worktree current --json   # → .result.worktree.path
```

If that fails (no `orca` CLI, or a folder workspace it does not list), use the directory you were
started in. Then always use the absolute path `<root>/.reins/state.json`, never a relative one.

## On every response

1. Read the board. If it is missing, create it as `{ "version": 1, "groups": [] }`
   (and `<root>/.reins/.gitignore` containing `*` if that is missing).
2. Track each open topic, question, todo or doubt needed to complete the goal, especially
   anything the **user** must decide or do, and anything you found during the work. One todo
   per item; do not duplicate an existing one.
3. Close (`"status": "closed"`) todos that got resolved, by you or by the user's answer.
4. Put todos into logical groups (emoji + short title). Create, rename, reorder or archive
   groups as the context or the user's prompts dictate.
5. Write the file back as a whole (valid JSON, 2-space indent). Re-read right before writing:
   the user may have edited it in the panel meanwhile.

## Rules

- Never delete todos or groups; close or archive instead. Deleting is the user's action.
- Archive (`"archived": true`) only closed todos, or groups whose todos are all closed.
- Leave items the user archived or reopened alone unless asked.
- Keep `id`s stable; new ids are short random strings (e.g. `k3f9qa`). Keep unknown fields.
- `description` is markdown: context, options, what is needed from the user. Optional.
- When a todo needs the user, say so in your reply too.

## Shape

```json
{
  "version": 1,
  "groups": [
    {
      "id": "g1a2b3",
      "emoji": "❓",
      "title": "Decisions for user",
      "archived": false,
      "todos": [
        {
          "id": "t4c5d6",
          "title": "Commit .reins/ or keep it ignored?",
          "description": "Committing keeps the board with the branch.",
          "status": "open",
          "archived": false
        }
      ]
    }
  ]
}
```
