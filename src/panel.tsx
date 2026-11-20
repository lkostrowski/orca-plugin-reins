// The board for the focused workspace. The worker owns the file; this panel only renders a
// Snapshot and sends whole new states back.
import {
  atom,
  Box,
  Button,
  Callout,
  Card,
  Code,
  EmptyState,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  read,
  Row,
  Select,
  Separator,
  set,
  Spinner,
  Stack,
  Switch,
  Text,
  Textarea,
  update,
  type PanelContext
} from 'orca'
import type { Group, ReinsState, Snapshot, Todo } from './protocol'

const workspaceId = atom<string | null | undefined>(undefined)
const snap = atom<Snapshot | null>(null)
const error = atom<string | null>(null)
const showArchived = atom('showArchived', false, { persist: 'plugin' })
/** Description shown (true) or hidden (false) by the person; unset = open todos show, closed hide. */
const expanded = atom('expanded', {} as Record<string, boolean>, { persist: 'workspace' })
/** Groups the person folded (or unfolded, for archived ones), per workspace. */
const foldedGroups = atom('foldedGroups', {} as Record<string, boolean>, { persist: 'workspace' })
/** Todo or group being edited, with its draft. */
const editing = atom<{ id: string; title: string; description: string; emoji: string; groupId: string } | null>(null)
/** The new-todo form (shown instead of its group's list) and the new-group form; null = closed. */
const newTodo = atom<{ groupId: string; title: string; description: string } | null>(null)
const newGroup = atom<{ emoji: string; title: string } | null>(null)

const newId = () => Math.random().toString(36).slice(2, 8)

async function load(id: string | null): Promise<void> {
  set(workspaceId, id)
  set(snap, null)
  if (!id) return
  try {
    set(snap, await plugin.request('reins.get', { workspaceId: id }))
    set(error, null)
  } catch (e) {
    set(error, (e as Error).message)
  }
}

/** Applies `fn` to a copy of the board and saves it; on refusal shows why and reloads. */
async function change(fn: (state: ReinsState) => void): Promise<void> {
  const current = read(snap)
  if (!current) return
  const state = structuredClone(current.state)
  fn(state)
  set(snap, { ...current, state })
  try {
    set(snap, await plugin.request('reins.save', { workspaceId: current.workspaceId, rev: current.rev, state }))
    set(error, null)
  } catch (e) {
    set(error, (e as Error).message)
    await load(current.workspaceId)
  }
}

const findGroup = (s: ReinsState, id: string) => s.groups.find((g) => g.id === id)!
function findTodo(s: ReinsState, id: string): { group: Group; todo: Todo; index: number } {
  for (const group of s.groups) {
    const index = group.todos.findIndex((t) => t.id === id)
    if (index >= 0) return { group, todo: group.todos[index], index }
  }
  throw new Error(`Todo ${id} is gone`)
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    // Fires once on subscribe with the current workspace, then on every switch.
    on('workspace.changed', ({ context }) => {
      const id = context?.workspaceId ?? null
      if (id !== read(workspaceId)) void load(id)
    }),
    plugin.on('reins.changed', (next) => {
      if (next.workspaceId === read(workspaceId)) set(snap, next)
    })
  )
}

function TodoEditor({ groups }: { groups: Group[] }) {
  const draft = read(editing)!
  const patch = (p: Partial<typeof draft>) => update(editing, (d) => (d ? { ...d, ...p } : d))
  return (
    <Stack gap="md">
      <Input label="Title" value={draft.title} onChange={(title) => patch({ title })} />
      <Textarea label="Description (markdown)" rows={5} value={draft.description} onChange={(description) => patch({ description })} />
      <Select
        label="Group"
        value={draft.groupId}
        options={groups.map((g) => ({ value: g.id, label: `${g.emoji} ${g.title}` }))}
        onChange={(groupId) => patch({ groupId })}
      />
      <Row gap="xs" justify="between">
        <Button
          size="sm"
          variant="ghost"
          tone="danger"
          onPress={() =>
            change((s) => {
              const { group, index } = findTodo(s, draft.id)
              group.todos.splice(index, 1)
            }).then(() => set(editing, null))
          }
        >
          Delete
        </Button>
        <Row gap="xs">
          <Button size="sm" variant="ghost" onPress={() => set(editing, null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onPress={() =>
              change((s) => {
                const { group, todo, index } = findTodo(s, draft.id)
                todo.title = draft.title.trim() || todo.title
                todo.description = draft.description || undefined
                if (group.id !== draft.groupId) {
                  group.todos.splice(index, 1)
                  findGroup(s, draft.groupId).todos.push(todo)
                }
              }).then(() => set(editing, null))
            }
          >
            Save
          </Button>
        </Row>
      </Row>
    </Stack>
  )
}

function NewTodo() {
  const draft = read(newTodo)!
  const patch = (p: Partial<typeof draft>) => update(newTodo, (d) => (d ? { ...d, ...p } : d))
  const save = () => {
    const title = draft.title.trim()
    if (!title) return
    void change((s) =>
      findGroup(s, draft.groupId).todos.push({ id: newId(), title, description: draft.description || undefined, status: 'open' })
    ).then(() => set(newTodo, null))
  }
  return (
    <Stack gap="md">
      <Input label="Title" value={draft.title} onChange={(title) => patch({ title })} onSubmit={save} />
      <Textarea label="Description (markdown)" rows={5} value={draft.description} onChange={(description) => patch({ description })} />
      <Row gap="xs" justify="end">
        <Button size="sm" variant="ghost" onPress={() => set(newTodo, null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!draft.title.trim()} onPress={save}>
          Save
        </Button>
      </Row>
    </Stack>
  )
}

/** Inline `code` as Code, **bold** as semibold Text, the rest as text. */
function inline(line: string) {
  return line.split('`').flatMap((part, i) =>
    i % 2
      ? [<Code key={`c${i}`}>{part}</Code>]
      : part.split('**').map((t, j) => (j % 2 ? <Text key={`b${i}.${j}`} muted size="sm" weight="semibold">{t}</Text> : t))
  )
}

// ponytail: Markdown cannot be muted, so descriptions get a line renderer: bullets, inline and
// fenced code, bold. Italics and links show as plain text; render with Markdown if they matter.
function Description({ text }: { text: string }) {
  let fenced = false
  const lines: { code: boolean; text: string }[] = []
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    else if (fenced || line.trim()) lines.push({ code: fenced, text: line.replace(/^(\s*)[-*] /, '$1• ') })
  }
  return (
    <Stack gap="xs">
      {lines.map((line, i) => (
        <Text key={String(i)} muted size="sm">
          {line.code ? <Code>{line.text}</Code> : inline(line.text)}
        </Text>
      ))}
    </Stack>
  )
}

function TodoView({ todo, groups }: { todo: Todo; groups: Group[] }) {
  if (read(editing)?.id === todo.id) return <TodoEditor groups={groups} />
  const closed = todo.status === 'closed'
  const open = read(expanded)[todo.id] ?? !closed
  const edit = () =>
    set(editing, {
      id: todo.id,
      title: todo.title,
      description: todo.description ?? '',
      emoji: '',
      groupId: groups.find((g) => g.todos.includes(todo))!.id
    })
  return (
    <Box direction="row" gap="xs" align="start">
      <IconButton
        icon={closed ? 'check' : 'stop'}
        label={closed ? `Reopen “${todo.title}”` : `Close “${todo.title}”`}
        variant="ghost"
        tone={closed ? 'success' : 'neutral'}
        size="sm"
        onPress={() => {
          // Back to the default for the new status: closing collapses, reopening expands.
          update(expanded, ({ [todo.id]: _, ...rest }) => rest)
          return change((s) => (findTodo(s, todo.id).todo.status = closed ? 'open' : 'closed'))
        }}
      />
      <Box grow>
        <List>
          {/* A closed todo's title dims like its description; an open one keeps the bright title. */}
          <ListItem title={closed ? undefined : todo.title} onPress={edit}>
            {closed ? (
              <Text muted>{todo.archived ? `${todo.title} (archived)` : todo.title}</Text>
            ) : null}
            {open && todo.description ? <Description text={todo.description} /> : null}
          </ListItem>
        </List>
      </Box>
      {todo.description ? (
        <IconButton
          icon={open ? 'collapse' : 'expand'}
          label={open ? 'Hide details' : 'Show details'}
          variant="ghost"
          size="sm"
          onPress={() => update(expanded, (m) => ({ ...m, [todo.id]: !open }))}
        />
      ) : null}
      {closed ? (
        <IconButton
          icon={todo.archived ? 'refresh' : 'package'}
          label={todo.archived ? 'Unarchive' : 'Archive'}
          variant="ghost"
          size="sm"
          onPress={() => change((s) => (findTodo(s, todo.id).todo.archived = !todo.archived || undefined))}
        />
      ) : null}
    </Box>
  )
}

function GroupEditor() {
  const draft = read(editing)!
  return (
    <Stack gap="sm">
      <Box direction="row" gap="xs">
        {/* ponytail: 36px ≈ input height, so the icon field reads square. */}
        <Box width={36} shrink={false}>
          <Input label="Icon" value={draft.emoji} maxLength={8} onChange={(emoji) => update(editing, (d) => d && { ...d, emoji })} />
        </Box>
        <Box grow>
          <Input label="Title" value={draft.title} onChange={(title) => update(editing, (d) => d && { ...d, title })} />
        </Box>
      </Box>
      <Row gap="xs">
        <Button
          size="sm"
          onPress={() =>
            change((s) => {
              const g = findGroup(s, draft.id)
              g.emoji = draft.emoji.trim() || g.emoji
              g.title = draft.title.trim() || g.title
            }).then(() => set(editing, null))
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onPress={() => set(editing, null)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          tone="danger"
          onPress={() =>
            change((s) => {
              s.groups = s.groups.filter((g) => g.id !== draft.id)
            }).then(() => set(editing, null))
          }
        >
          Delete group
        </Button>
      </Row>
    </Stack>
  )
}

function GroupView({ group, groups, all }: { group: Group; groups: Group[]; all: boolean }) {
  // Open todos first; sort is stable, so each half keeps the file's order. View only, the file is untouched.
  const todos = group.todos.filter((t) => all || !t.archived).sort((x, y) => +(x.status === 'closed') - +(y.status === 'closed'))
  const openCount = group.todos.filter((t) => t.status === 'open').length
  const closedVisible = group.todos.some((t) => t.status === 'closed' && !t.archived)
  const folded = read(foldedGroups)[group.id] ?? !!group.archived
  const fold = () => update(foldedGroups, (m) => ({ ...m, [group.id]: !folded }))
  return (
    <Stack gap="md">
      {read(editing)?.id === group.id ? (
        <GroupEditor />
      ) : (
        <Box direction="row" gap="xs" align="center">
          <Box grow>
            <List>
              <ListItem
                title={`${group.emoji} ${group.title}${group.archived ? ' (archived)' : ''}`}
                description={`${openCount} open · ${group.todos.length - openCount} closed`}
                onPress={fold}
              />
            </List>
          </Box>
          <IconButton
            icon="add"
            label="New todo"
            variant="ghost"
            size="sm"
            onPress={() => {
              set(newTodo, { groupId: group.id, title: '', description: '' })
              update(foldedGroups, (m) => ({ ...m, [group.id]: false }))
            }}
          />
          <IconButton
            icon="edit"
            label="Edit group"
            variant="ghost"
            size="sm"
            onPress={() => set(editing, { id: group.id, title: group.title, description: '', emoji: group.emoji, groupId: group.id })}
          />
          {closedVisible ? (
            <IconButton
              icon="check"
              label="Archive closed todos"
              variant="ghost"
              size="sm"
              onPress={() =>
                change((s) => findGroup(s, group.id).todos.forEach((t) => t.status === 'closed' && (t.archived = true)))
              }
            />
          ) : null}
          <IconButton
            icon={group.archived ? 'refresh' : 'package'}
            label={group.archived ? 'Unarchive group' : 'Archive group'}
            variant="ghost"
            size="sm"
            onPress={() => change((s) => (findGroup(s, group.id).archived = !group.archived || undefined))}
          />
        </Box>
      )}
      {folded ? null : read(newTodo)?.groupId === group.id ? (
        <NewTodo />
      ) : (
        <Stack gap="md">
          {todos.map((todo) => (
            <TodoView key={todo.id} todo={todo} groups={groups} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}

// ponytail: Orca's panel kit has no Modal; a Card at the top of the panel stands in for one.
function AddGroup() {
  const g = read(newGroup)!
  const add = () => {
    if (!g.title.trim()) return
    set(newGroup, null)
    void change((s) => s.groups.push({ id: newId(), emoji: g.emoji.trim() || '📌', title: g.title.trim(), todos: [] }))
  }
  return (
    <Card title="New group">
      <Stack gap="sm">
        <Box direction="row" gap="xs" align="center">
          <Box width={64} shrink={false}>
            <Input label="Emoji" labelHidden placeholder="📌" maxLength={8} value={g.emoji} onChange={(emoji) => set(newGroup, { ...g, emoji })} />
          </Box>
          <Box grow>
            <Input label="Title" labelHidden placeholder="Group title…" value={g.title} onChange={(title) => set(newGroup, { ...g, title })} onSubmit={add} />
          </Box>
        </Box>
        <Row gap="xs">
          <Button size="sm" onPress={add}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onPress={() => set(newGroup, null)}>
            Cancel
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

export default function Panel() {
  const id = read(workspaceId)
  const s = read(snap)
  const err = read(error)
  const all = read(showArchived)
  if (id === null) return <EmptyState title="No workspace" description="Open a workspace to see its board." />
  if (!s) return err ? <Callout tone="danger">{err}</Callout> : <Spinner label="Loading board" />
  const groups = s.state.groups.filter((g) => all || !g.archived)
  return (
    <Stack gap="lg">
      {err ? (
        <Callout tone="warning" title="Not saved">
          {err}
        </Callout>
      ) : null}
      <Row justify="between">
        <Text muted size="xs" truncate>
          .reins/state.json
        </Text>
        <Row gap="xs" align="center">
          <Switch label="Show archived" checked={all} onChange={(v) => set(showArchived, v)} />
          <IconButton icon="add" label="New group" variant="ghost" size="sm" onPress={() => set(newGroup, { emoji: '', title: '' })} />
        </Row>
      </Row>
      {read(newGroup) ? <AddGroup /> : null}
      {groups.length === 0 ? (
        <EmptyState title="Nothing tracked yet" description="The agent adds todos as it works, or add a group with +." icon="check" />
      ) : null}
      {/* The separator sits in the Stack's gap, so groups get gap + line + gap between them. */}
      {groups.flatMap((g, i) => [
        i ? <Separator key={`sep-${g.id}`} /> : null,
        <GroupView key={g.id} group={g} groups={s.state.groups} all={all} />
      ])}
    </Stack>
  )
}
