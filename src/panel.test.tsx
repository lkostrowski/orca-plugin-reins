import { assert, mockHost, mount, test } from 'orca/testing'
import type { ReinsState, Snapshot } from './protocol'
import * as panel from './panel'

test('shows the workspace board, adds and closes todos, follows agent edits', async () => {
  let state: ReinsState = {
    version: 1,
    groups: [{ id: 'g', emoji: '❓', title: 'Decisions', todos: [{ id: 't', title: 'Pick a DB', status: 'open' }] }]
  }
  let rev = 1
  let copied = ''
  const snap = (): Snapshot => ({ workspaceId: 'w1', path: '/repo', rev, state })
  const host = mockHost({
    requests: {
      'reins.get': () => snap(),
      'reins.save': (input) => {
        assert.equal(input.rev, rev)
        state = input.state
        rev++
        return snap()
      },
      'reins.copy': (input) => {
        copied = input.text
        return null
      }
    }
  })
  const view = await mount(panel, { host })
  await view.emit('workspace.changed', { context: { workspaceId: 'w1', branch: 'main', displayName: 'repo', terminals: [] } })
  assert.ok(view.find({ text: 'Pick a DB' }))

  await view.press({ label: 'New todo' })
  await view.type({ label: 'Title' }, 'Ask about auth')
  await view.press({ text: 'Save' })
  assert.deepEqual(state.groups[0].todos.map((t) => t.title), ['Pick a DB', 'Ask about auth'])

  // Clicking a todo opens its editor.
  await view.press({ text: 'Pick a DB' })
  assert.equal(view.valueOf({ label: 'Title' }), 'Pick a DB')
  await view.press({ text: 'Cancel' })

  await view.press({ label: 'Copy “Pick a DB”' })
  assert.equal(copied, '> Pick a DB')

  await view.press({ label: 'Close “Pick a DB”' })
  assert.equal(state.groups[0].todos[0].status, 'closed')

  // The group heading folds the group.
  await view.press({ text: /Decisions/ })
  assert.equal(view.find({ text: 'Ask about auth' }), null)
  await view.press({ text: /Decisions/ })

  // The agent wrote the file: the worker posts the new board.
  await view.post('reins.changed', { ...snap(), rev: 99, state: { version: 1, groups: [] } })
  assert.ok(view.summary().some((line) => line.includes('Nothing tracked yet')), view.summary().join('\n'))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
