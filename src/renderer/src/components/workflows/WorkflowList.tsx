import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Play, Pencil, Square, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import WorkflowTipsCard from './WorkflowTipsCard'
import WorkflowCreateDialog from './WorkflowCreateDialog'
import WorkflowImportSshDialog from './WorkflowImportSshDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { downloadWorkflowJson, importWorkflowJson } from './workflow-export-import'
import type { AgentWorkflow, WorkflowRun } from '../../../../shared/workflow-types'
import { isFinalWorkflowRunStatus } from '../../../../shared/workflow-types'

type PendingSshImport = {
  name: string
  nodes: AgentWorkflow['nodes']
  edges: AgentWorkflow['edges']
}

type Props = {
  selectedWorkflowId: string | null
  onSelect: (wf: AgentWorkflow | null) => void
}

type WorkflowStatus = 'running' | 'scheduled' | 'inactive'

function getWorkflowStatus(wf: AgentWorkflow, runs: WorkflowRun[]): WorkflowStatus {
  if (runs.some((r) => r.workflowId === wf.id && !isFinalWorkflowRunStatus(r.status))) {
    return 'running'
  }
  if (wf.enabled) {
    return 'scheduled'
  }
  return 'inactive'
}

function WorkflowStatusDot({ status }: { status: WorkflowStatus }): React.JSX.Element {
  if (status === 'inactive') {
    return <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />
  }
  if (status === 'running') {
    return (
      <span className="relative flex size-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full text-status-success bg-current opacity-75" />
        <span className="relative inline-flex rounded-full size-2 text-status-success bg-current" />
      </span>
    )
  }
  return (
    <span className="size-2 rounded-full text-status-success bg-current animate-pulse shrink-0" />
  )
}

export default function WorkflowList({ selectedWorkflowId, onSelect }: Props): React.JSX.Element {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingSshImport, setPendingSshImport] = useState<PendingSshImport | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.workflows.list().then(setWorkflows)
    void window.api.workflows.getRuns().then(setRuns)
    const unsub = window.api.workflows.onChanged(({ workflows: wfs, runs: rs }) => {
      setWorkflows(wfs)
      setRuns(rs)
    })
    return unsub
  }, [])

  function handleCreated(wf: AgentWorkflow): void {
    onSelect(wf)
    setCreateDialogOpen(false)
  }

  async function handleDelete(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    await window.api.workflows.delete(id)
    if (selectedWorkflowId === id) {
      onSelect(null)
    }
  }

  async function handleRunNow(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    await window.api.workflows.runNow(id)
  }

  async function handleStop(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    await window.api.workflows.stop(id)
  }

  function openRename(wf: AgentWorkflow, e: React.MouseEvent): void {
    e.stopPropagation()
    setRenamingId(wf.id)
    setRenameValue(wf.name)
  }

  async function handleRenameSave(): Promise<void> {
    if (!renamingId || !renameValue.trim()) {
      return
    }
    await window.api.workflows.update(renamingId, { name: renameValue.trim() })
    setRenamingId(null)
  }

  async function handleImport(file: File): Promise<void> {
    try {
      const raw = await file.text()
      const { name, executionTargetType, nodes, edges } = importWorkflowJson(raw)
      if (executionTargetType === 'ssh') {
        setPendingSshImport({ name, nodes, edges })
        return
      }
      await createImportedWorkflow({
        name,
        executionTargetType: 'local',
        executionTargetId: 'local',
        nodes,
        edges
      })
    } catch {
      toast.error(translate('workflows.list.importError', 'Failed to import workflow'))
    }
  }

  async function createImportedWorkflow({
    name,
    executionTargetType,
    executionTargetId,
    nodes,
    edges
  }: {
    name: string
    executionTargetType: 'local' | 'ssh'
    executionTargetId: string
    nodes: AgentWorkflow['nodes']
    edges: AgentWorkflow['edges']
  }): Promise<void> {
    const wf = await window.api.workflows.create({
      name,
      description: '',
      schedule: null,
      enabled: false,
      executionTargetType,
      executionTargetId,
      nodes,
      edges
    })
    onSelect(wf)
    toast.success(translate('workflows.list.importSuccess', 'Workflow imported'))
  }

  async function handleSshImportConfirm(targetId: string): Promise<void> {
    if (!pendingSshImport) {
      return
    }
    const { name, nodes, edges } = pendingSshImport
    setPendingSshImport(null)
    try {
      await createImportedWorkflow({
        name,
        executionTargetType: 'ssh',
        executionTargetId: targetId,
        nodes,
        edges
      })
    } catch {
      toast.error(translate('workflows.list.importError', 'Failed to import workflow'))
    }
  }

  return (
    <>
      <WorkflowCreateDialog
        key={String(createDialogOpen)}
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreated}
      />
      <WorkflowImportSshDialog
        open={pendingSshImport !== null}
        workflowName={pendingSshImport?.name ?? ''}
        onClose={() => setPendingSshImport(null)}
        onImport={(targetId) => void handleSshImportConfirm(targetId)}
      />
      <div className="flex flex-col h-full min-h-0">
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              void handleImport(file)
            }
            e.target.value = ''
          }}
        />
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('workflows.list.title', 'Workflows')}
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => importInputRef.current?.click()}
              title={translate('workflows.list.import', 'Import workflow')}
            >
              <Upload className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-sleek min-h-0">
            {workflows.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-muted-foreground">
                {translate('workflows.list.empty', 'No workflows yet. Click + to create one.')}
              </div>
            ) : (
              workflows.map((wf) => {
                const status = getWorkflowStatus(wf, runs)
                return (
                  <div
                    key={wf.id}
                    onClick={() => onSelect(wf)}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 border-b border-border/50',
                      selectedWorkflowId === wf.id && 'bg-muted'
                    )}
                  >
                    <WorkflowStatusDot status={status} />
                    <span className="flex-1 text-[13px] truncate font-medium">{wf.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-5"
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadWorkflowJson(wf)
                        }}
                        title={translate('workflows.list.export', 'Export workflow')}
                      >
                        <Download className="size-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-5"
                        onClick={(e) => openRename(wf, e)}
                        title={translate('workflows.list.rename', 'Rename')}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-5"
                        onClick={(e) => void handleRunNow(wf.id, e)}
                        title={translate('workflows.list.runNow', 'Run now')}
                      >
                        <Play className="size-3" />
                      </Button>
                      {wf.enabled && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5"
                          onClick={(e) => void handleStop(wf.id, e)}
                          title={translate('workflows.list.stopScheduling', 'Stop scheduling')}
                        >
                          <Square className="size-3" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="destructive"
                        className="size-5"
                        onClick={(e) => void handleDelete(wf.id, e)}
                        title={translate('workflows.list.delete', 'Delete')}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <WorkflowTipsCard />
        </div>
      </div>

      <Dialog open={renamingId !== null} onOpenChange={(open) => !open && setRenamingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{translate('workflows.list.renameTitle', 'Rename Workflow')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleRenameSave()
              }
            }}
            autoFocus
            className="h-8"
            placeholder={translate('workflows.list.namePlaceholder', 'Workflow name')}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRenamingId(null)}>
              {translate('workflows.list.cancel', 'Cancel')}
            </Button>
            <Button size="sm" onClick={() => void handleRenameSave()}>
              {translate('workflows.list.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
