import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import WorkflowCronScheduleField from './WorkflowCronScheduleField'
import WorkflowAgentNodeFields from './WorkflowAgentNodeFields'
import type { AgentWorkflow } from '../../../../shared/workflow-types'

type Props = {
  workflow: AgentWorkflow
  nodeId: string
  onClose: () => void
  onWorkflowChange: (wf: AgentWorkflow) => void
}

// Fields that get a Monaco editor instead of a plain text input
function getMonacoFields(): Record<string, { language: string; label: string }> {
  return {
    script: { language: 'python', label: translate('workflows.nodeEditor.fieldScript', 'Script') },
    command: {
      language: 'shell',
      label: translate('workflows.nodeEditor.fieldCommand', 'Command')
    },
    expression: {
      language: 'javascript',
      label: translate('workflows.nodeEditor.fieldExpression', 'Expression')
    }
  }
}

function getAvailableShells(isRemote: boolean): string[] {
  if (isRemote) {
    return ['bash', 'sh', 'zsh', 'tcsh', 'fish']
  }
  if (navigator.userAgent.includes('Win')) {
    return ['powershell', 'cmd']
  }
  if (navigator.userAgent.includes('Mac')) {
    return ['zsh', 'bash', 'sh']
  }
  return ['bash', 'sh', 'zsh', 'tcsh']
}

export default function WorkflowNodeEditorPanel({
  workflow,
  nodeId,
  onClose,
  onWorkflowChange
}: Props): React.JSX.Element {
  const node = workflow.nodes.find((n) => n.id === nodeId)
  const isDark = useDocumentDarkTheme()

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: node.data is a plain record; exact shape varies by node type but all values are serializable
  const [localData, setLocalData] = useState<Record<string, string>>(
    node
      ? Object.fromEntries(
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same as above
          Object.entries(node.data as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
        )
      : {}
  )

  const isAgentCall = node?.type === 'agent_call'
  const isShellCommand = node?.type === 'shell_command'
  const isFileWrite = node?.type === 'file_write'
  const isRemote = workflow.executionTargetType === 'ssh'

  const handleSave = useCallback(async (): Promise<void> => {
    if (!node) {
      return
    }
    const updatedNodes = workflow.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...localData } } : n
    )
    const cronNode = updatedNodes.find((n) => n.type === 'trigger_cron')
    const schedulePatch =
      node.type === 'trigger_cron' && localData['schedule'] !== undefined
        ? { schedule: localData['schedule'] || null }
        : {}
    const updated = await window.api.workflows.update(workflow.id, {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: updatedNodes preserves the discriminated union structure; data field values may widen to unknown but nodes array is type-compatible
      nodes: updatedNodes as AgentWorkflow['nodes'],
      ...schedulePatch
    })
    if (updated) {
      onWorkflowChange(updated)
      toast.success(translate('workflows.node.saved', 'Node saved'))
    }
    void cronNode
  }, [node, nodeId, localData, workflow, onWorkflowChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') {
        return
      }
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  if (!node) {
    return <div />
  }

  const isCronTrigger = node.type === 'trigger_cron'

  const genericFields = Object.keys(localData).filter((k) => {
    if (
      isAgentCall &&
      (k === 'agentId' ||
        k === 'model' ||
        k === 'structuredOutputSchema' ||
        k === 'customExecutable' ||
        k === 'customArgTemplate')
    ) {
      return false
    }
    if (isCronTrigger && k === 'schedule') {
      return false
    }
    if (isShellCommand && k === 'shell') {
      return false
    }
    if (isFileWrite && (k === 'mode' || k === 'createParents')) {
      return false
    }
    return true
  })

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[13px] font-semibold">{node.type.replace(/_/g, ' ')}</span>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-sleek p-3 space-y-3">
        {isAgentCall && (
          <WorkflowAgentNodeFields
            isRemote={isRemote}
            executionTargetId={workflow.executionTargetId}
            localData={localData}
            onDataChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
          />
        )}
        {isCronTrigger && (
          <WorkflowCronScheduleField
            value={localData['schedule'] ?? ''}
            onChange={(v) => setLocalData((prev) => ({ ...prev, schedule: v }))}
          />
        )}
        {isShellCommand && (
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {translate('workflows.nodeEditor.shell', 'Shell')}
            </span>
            <Select
              value={localData['shell'] ?? ''}
              onValueChange={(v) => setLocalData((prev) => ({ ...prev, shell: v }))}
            >
              <SelectTrigger className="h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getAvailableShells(isRemote).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {isFileWrite && (
          <>
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('workflows.nodeEditor.fileWriteMode', 'Mode')}
              </span>
              <Select
                value={localData['mode'] ?? 'overwrite'}
                onValueChange={(v) => setLocalData((prev) => ({ ...prev, mode: v }))}
              >
                <SelectTrigger className="h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overwrite">
                    {translate('workflows.nodeEditor.fileWriteModeOverwrite', 'Overwrite')}
                  </SelectItem>
                  <SelectItem value="append">
                    {translate('workflows.nodeEditor.fileWriteModeAppend', 'Append')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={localData['createParents'] !== 'false'}
                onChange={(e) =>
                  setLocalData((prev) => ({ ...prev, createParents: String(e.target.checked) }))
                }
              />
              {translate('workflows.nodeEditor.createParents', 'Create parent directories')}
            </label>
          </>
        )}
        {genericFields.map((key) => {
          const monacoConfig = getMonacoFields()[key]
          if (monacoConfig) {
            return (
              <div key={key} className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {monacoConfig.label}
                </span>
                <div
                  className="rounded border border-border overflow-hidden"
                  style={{ height: 180 }}
                >
                  <Editor
                    value={localData[key]}
                    language={monacoConfig.language}
                    theme={isDark ? 'vs-dark' : 'light'}
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      fontSize: 12,
                      tabSize: 2,
                      automaticLayout: true,
                      padding: { top: 6, bottom: 6 }
                    }}
                    onChange={(v) => setLocalData((prev) => ({ ...prev, [key]: v ?? '' }))}
                  />
                </div>
              </div>
            )
          }
          return (
            <div key={key} className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {key}
              </span>
              <Input
                value={localData[key]}
                onChange={(e) => setLocalData((prev) => ({ ...prev, [key]: e.target.value }))}
                className="h-7"
              />
            </div>
          )
        })}
      </div>
      <div className="px-3 py-2 border-t border-border shrink-0">
        <Button size="sm" className="w-full h-7" onClick={() => void handleSave()}>
          {translate('workflows.node.save', 'Save')}
        </Button>
      </div>
    </div>
  )
}
