import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

test('reads, saves, ignores itself in git and refuses stale saves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reins-'))
  const host = mockHost({
    results: { 'workspace.list': { workspaces: [{ id: 'w1', kind: 'folder', name: 'w', path: dir, branch: null, hostId: 'local' }], truncated: false } }
  })
  const worker = await mountWorker(main, { host })

  const empty = await worker.request('reins.get', { workspaceId: 'w1' })
  assert.deepEqual(empty.state, { version: 1, groups: [] })
  assert.equal(empty.rev, 0)
  assert.equal(await readFile(join(dir, '.reins', '.gitignore'), 'utf8'), '*\n')

  const state = { version: 1 as const, groups: [{ id: 'g', emoji: '❓', title: 'Q', todos: [] }] }
  const saved = await worker.request('reins.save', { workspaceId: 'w1', rev: 0, state })
  assert.deepEqual(saved.state, state)
  assert.ok(saved.rev > 0)

  // The agent writes meanwhile: a save against the old rev is refused.
  await new Promise((r) => setTimeout(r, 20))
  await writeFile(join(dir, '.reins', 'state.json'), JSON.stringify({ version: 1, groups: [] }))
  await assert.rejects(worker.request('reins.save', { workspaceId: 'w1', rev: saved.rev, state }), (e: any) => e.code === 'conflict')

  await assert.rejects(worker.request('reins.get', { workspaceId: 'nope' }))
  await worker.deactivate()
})
