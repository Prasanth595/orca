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
import WorkflowBranchConditionEditor from './WorkflowBranchConditionEditor'
import WorkflowFormInputEditor from './WorkflowFormInputEditor'
import WorkflowRetryFields from './WorkflowRetryFields'
import { NODE_TYPE_LABELS } from './workflow-canvas-node-config'
import { getMonacoFields, getAvailableShells, coerceNodeData } from './workflow-node-editor-config'
import { useLastRunSteps } from './use-last-run-steps'
import type {
  AgentWorkflow,
  BranchCondition,
  FormInputData,
  FormInputField
} from '../../../../shared/workflow-types'

type Props = {
  workflow: AgentWorkflow
  nodeId: string
  onClose: () => void
  onWorkflowChange: (wf: AgentWorkflow) => void
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
          Object.entries(node.data as Record<string, unknown>)
            .filter(([, v]) => !Array.isArray(v) && typeof v !== 'object')
            .map(([k, v]) => [k, String(v ?? '')])
        )
      : {}
  )
  const [nodeLabel, setNodeLabel] = useState<string>(node?.label ?? '')

  const isBranchNode = node?.type === 'branch'
  const [branchValues, setBranchValues] = useState<{
    conditions: BranchCondition[]
    defaultLabel: string
  }>(() => {
    if (!isBranchNode) {
      return { conditions: [], defaultLabel: 'otherwise' }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded by isBranchNode; BranchData always has conditions[] and defaultLabel
    const d = node.data as { conditions: BranchCondition[]; defaultLabel: string }
    return { conditions: d.conditions, defaultLabel: d.defaultLabel }
  })

  const isFormInput = node?.type === 'form_input'
  const [formFields, setFormFields] = useState<FormInputField[]>(() => {
    if (!isFormInput || !node) {
      return []
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded by isFormInput; FormInputData always has fields[]
    return (node.data as FormInputData).fields
  })

  const isAgentCall = node?.type === 'agent_call'
  const isShellCommand = node?.type === 'shell_command'
  const isFileWrite = node?.type === 'file_write'
  const isForEach = node?.type === 'for_each'
  const isCollect = node?.type === 'collect'
  const isTriggerManual = node?.type === 'trigger_manual'
  const isRemote = workflow.executionTargetType === 'ssh'

  // Last-run steps for expression hints and branch field hints
  const { steps, resolveExpr } = useLastRunSteps(workflow.id)

  // Derive parent-node output for branch condition hints from the loaded steps
  const parentEdge = isBranchNode
    ? workflow.edges.find((e) => e.targetNodeId === nodeId)
    : undefined
  const parentStep = parentEdge ? steps[parentEdge.sourceNodeId] : undefined
  const parentNodeLastRun = parentStep
    ? (() => {
        let exitCode: number | null = null
        try {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: parsing runtime JSON; exitCode may or may not be present
          exitCode =
            (JSON.parse(parentStep.output) as { exitCode?: number } | null)?.exitCode ?? null
        } catch {
          /* ignore */
        }
        return { output: parentStep.output, json: parentStep.json, exitCode }
      })()
    : undefined

  const handleSave = useCallback(async (): Promise<void> => {
    if (!node) {
      return
    }

    const nodeDataPatch: Record<string, unknown> = isBranchNode
      ? { conditions: branchValues.conditions, defaultLabel: branchValues.defaultLabel }
      : isFormInput
        ? { fields: formFields }
        : coerceNodeData(localData)

    const updatedNodes = workflow.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, ...nodeDataPatch }, label: nodeLabel || undefined }
        : n
    )
    const schedulePatch =
      node.type === 'trigger_cron' && localData['schedule'] !== undefined
        ? { schedule: localData['schedule'] || null }
        : {}
    const updated = await window.api.workflows.update(workflow.id, {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: updatedNodes preserves the discriminated union structure
      nodes: updatedNodes as AgentWorkflow['nodes'],
      ...schedulePatch
    })
    if (updated) {
      onWorkflowChange(updated)
      toast.success(translate('workflows.node.saved', 'Node saved'))
    }
  }, [
    node,
    nodeId,
    localData,
    nodeLabel,
    isBranchNode,
    branchValues,
    isFormInput,
    formFields,
    workflow,
    onWorkflowChange
  ])

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
  const hasRetry =
    node.type !== 'trigger_cron' &&
    node.type !== 'trigger_manual' &&
    node.type !== 'branch' &&
    node.type !== 'collect' &&
    node.type !== 'form_input'

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
    if (isBranchNode || isFormInput) {
      return false
    }
    if (isForEach && (k === 'itemsExpression' || k === 'maxIterations')) {
      return false
    }
    if (k === 'retryCount' || k === 'retryDelaySeconds') {
      return false
    }
    return true
  })

  /** Show a resolved hint below a plain-text input when the value has {{}} expressions. */
  function exprHint(value: string): React.JSX.Element | null {
    if (!value.includes('{{')) {
      return null
    }
    const resolved = resolveExpr(value)
    if (resolved === value) {
      return null
    }
    const display = resolved.replace(/\n/g, '↵').replace(/\s+/g, ' ').trim()
    const truncated = display.length > 80 ? `${display.slice(0, 80)}…` : display
    return (
      <span className="font-mono text-[10px] text-muted-foreground truncate block">
        {`→ ${truncated}`}
      </span>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[13px] font-semibold">{NODE_TYPE_LABELS[node.type]}</span>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-sleek p-3 space-y-3">
        {/* Label field — all node types */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {translate('workflows.nodeEditor.label', 'Label (optional)')}
          </span>
          <Input
            value={nodeLabel}
            onChange={(e) => setNodeLabel(e.target.value)}
            placeholder={translate('workflows.nodeEditor.labelPlaceholder', 'Custom display name…')}
            className="h-7"
          />
        </div>

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

        {isTriggerManual && (
          <p className="text-[12px] text-muted-foreground">
            {translate(
              'workflows.nodeEditor.manualTriggerHint',
              'This trigger fires when you click Run.'
            )}
          </p>
        )}

        {isCollect && (
          <p className="text-[12px] text-muted-foreground">
            {translate(
              'workflows.nodeEditor.collectHint',
              'Collects outputs from each For Each iteration into an array.'
            )}
          </p>
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
                  setLocalData((prev) => ({
                    ...prev,
                    createParents: e.target.checked ? 'true' : 'false'
                  }))
                }
              />
              {translate('workflows.nodeEditor.createParents', 'Create parent directories')}
            </label>
          </>
        )}

        {isForEach && (
          <>
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('workflows.nodeEditor.itemsExpression', 'Items expression')}
              </span>
              <Input
                value={localData['itemsExpression'] ?? ''}
                onChange={(e) =>
                  setLocalData((prev) => ({ ...prev, itemsExpression: e.target.value }))
                }
                placeholder="{{steps.nodeId.json.items}}"
                className="h-7"
              />
              {exprHint(localData['itemsExpression'] ?? '')}
              <p className="text-[10px] text-muted-foreground">
                {translate(
                  'workflows.nodeEditor.itemsExpressionHint',
                  'Template expression that resolves to a JSON array. Use {{loop.item}} and {{loop.index}} in body nodes.'
                )}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('workflows.nodeEditor.maxIterations', 'Max iterations')}
              </span>
              <Input
                type="number"
                value={localData['maxIterations'] ?? '100'}
                onChange={(e) =>
                  setLocalData((prev) => ({ ...prev, maxIterations: e.target.value }))
                }
                className="h-7"
                min={1}
                max={10000}
              />
            </div>
          </>
        )}

        {isBranchNode && (
          <WorkflowBranchConditionEditor
            initialConditions={branchValues.conditions}
            initialDefaultLabel={branchValues.defaultLabel}
            onChange={(conditions, defaultLabel) => setBranchValues({ conditions, defaultLabel })}
            parentNodeLastRun={parentNodeLastRun}
          />
        )}

        {isFormInput && (
          <WorkflowFormInputEditor initialFields={formFields} onChange={setFormFields} />
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
              {exprHint(localData[key] ?? '')}
            </div>
          )
        })}

        {hasRetry && (
          <WorkflowRetryFields
            retryCount={localData['retryCount'] ?? '0'}
            retryDelaySeconds={localData['retryDelaySeconds'] ?? '1'}
            onChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
          />
        )}
      </div>
      <div className="px-3 py-2 border-t border-border shrink-0">
        <Button size="sm" className="w-full h-7" onClick={() => void handleSave()}>
          {translate('workflows.node.save', 'Save')}
        </Button>
      </div>
    </div>
  )
}
