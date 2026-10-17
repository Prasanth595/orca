import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { WorkflowVariable, WorkflowVariableKind } from '../../../../shared/workflow-types'

export default function WorkflowVariablesPanel(): React.JSX.Element {
  const [variables, setVariables] = useState<WorkflowVariable[]>([])
  const [editKey, setEditKey] = useState('')
  const [editValue, setEditValue] = useState('')
  const [editKind, setEditKind] = useState<WorkflowVariableKind>('plaintext')
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const vars = await window.api.workflows.listVariables()
    setVariables(vars.slice().sort((a, b) => a.key.localeCompare(b.key)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm(): void {
    setEditKey('')
    setEditValue('')
    setEditKind('plaintext')
    setEditing(null)
  }

  async function handleSave(): Promise<void> {
    const key = editKey.trim()
    if (!key) {
      return
    }
    await window.api.workflows.setVariable({
      key,
      value: editValue,
      kind: editKind,
      updatedAt: Date.now()
    })
    resetForm()
    await load()
  }

  function startEdit(v: WorkflowVariable): void {
    setEditing(v.key)
    setEditKey(v.key)
    setEditValue(v.value)
    setEditKind(v.kind)
  }

  async function handleDelete(key: string): Promise<void> {
    await window.api.workflows.deleteVariable(key)
    if (editing === key) {
      resetForm()
    }
    await load()
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs text-muted-foreground">
          Use <code className="font-mono">{'{{$vars.KEY}}'}</code> in any node field to inject a
          value.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-sleek min-h-0">
        {variables.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No variables yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {variables.map((v) => (
              <li
                key={v.key}
                className="flex items-center gap-2 px-3 py-2 hover:bg-accent/40 group"
              >
                <span className="font-mono text-xs flex-1 truncate min-w-0">{v.key}</span>
                <span className="text-xs text-muted-foreground w-16 shrink-0">{v.kind}</span>
                <span className="text-xs flex-1 truncate min-w-0 text-muted-foreground">
                  {v.kind === 'secret' ? '••••••••' : v.value}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(v)}>
                    Edit
                  </Button>
                  <Button variant="destructive" size="xs" onClick={() => void handleDelete(v.key)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 shrink-0 flex flex-col gap-2">
        <p className="text-xs font-medium">{editing ? 'Edit variable' : 'New variable'}</p>
        <div className="flex gap-2">
          <Input
            className="h-7"
            placeholder="KEY"
            value={editKey}
            disabled={!!editing}
            onChange={(e) => setEditKey(e.target.value)}
          />
          <Select
            value={editKind}
            onValueChange={(v) => setEditKind(v === 'secret' ? 'secret' : 'plaintext')}
          >
            <SelectTrigger className="h-7 w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plaintext">Plaintext</SelectItem>
              <SelectItem value="secret">Secret</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          className="h-7"
          placeholder="Value"
          type={editKind === 'secret' ? 'password' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleSave()
            }
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" className="h-7 flex-1" onClick={() => void handleSave()}>
            {editing ? 'Update' : 'Add'}
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" className="h-7" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
