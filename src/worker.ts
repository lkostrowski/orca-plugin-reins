// Owns <workspace>/.reins/state.json: the agent edits it with its own file tools, the panel
// through this worker. One file per Orca workspace (worktree or folder).
import type { OrcaWorkerApi } from 'orca/worker'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReinsState, Snapshot } from './protocol'

const EMPTY: ReinsState = { version: 1, groups: [] }

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

// ponytail: local workspaces only; SSH/WSL paths are not on this disk.
async function workspacePath(orca: OrcaWorkerApi, workspaceId: string): Promise<string> {
  const { workspaces } = await orca.host.call('workspace.list', {})
  const ws = workspaces.find((w) => w.id === workspaceId)
  if (!ws) throw fail('invalid_params', `Unknown workspace ${workspaceId}`)
  if (ws.hostId && ws.hostId !== 'local') throw fail('action_failed', 'Remote workspaces are not supported yet')
  return ws.path
}

const dirOf = (path: string) => join(path, '.reins')
const fileOf = (path: string) => join(path, '.reins', 'state.json')

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirOf(path), { recursive: true })
  // Keep the board out of Git without touching the repo's own .gitignore.
  await writeFile(join(dirOf(path), '.gitignore'), '*\n', { flag: 'wx' }).catch(() => {})
}

async function load(workspaceId: string, path: string): Promise<Snapshot> {
  try {
    const [text, info] = await Promise.all([readFile(fileOf(path), 'utf8'), stat(fileOf(path))])
    return { workspaceId, path, rev: info.mtimeMs, state: JSON.parse(text) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspaceId, path, rev: 0, state: EMPTY }
    throw fail('action_failed', `Cannot read ${fileOf(path)}: ${(error as Error).message}`)
  }
}

const watchers = new Map<string, FSWatcher>()

export default function activate(orca: OrcaWorkerApi): void {
  async function watchBoard(workspaceId: string, path: string): Promise<void> {
    if (watchers.has(path)) return
    await ensureDir(path)
    let timer: ReturnType<typeof setTimeout> | undefined
    // Watch the folder, not the file: atomic writes (ours and most editors') replace the inode.
    const watcher = watch(dirOf(path), () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        load(workspaceId, path).then(
          (snap) => orca.panels.post('reins.changed', snap),
          (error) => orca.log(String(error))
        )
      }, 100)
    })
    watcher.on('error', () => watchers.delete(path))
    watchers.set(path, watcher)
  }

  orca.panels.handle('reins.get', async ({ workspaceId }) => {
    const path = await workspacePath(orca, workspaceId)
    await watchBoard(workspaceId, path)
    return load(workspaceId, path)
  })

  orca.panels.handle('reins.save', async ({ workspaceId, rev, state }) => {
    const path = await workspacePath(orca, workspaceId)
    // ponytail: mtime check then write is not atomic; fine for one person + one agent.
    if ((await load(workspaceId, path)).rev !== rev) throw fail('conflict', 'The board changed on disk; reloaded')
    await ensureDir(path)
    const tmp = `${fileOf(path)}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n')
    await rename(tmp, fileOf(path))
    return load(workspaceId, path)
  })
}

export function deactivate(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
}
