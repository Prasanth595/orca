import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Pencil, Eye } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import WorkflowCronScheduleField from './WorkflowCronScheduleField'
import WorkflowAgentNodeFields from './WorkflowAgentNodeFields'
import WorkflowBranchConditionEditor from './WorkflowBranchConditionEditor'
import WorkflowFormInputEditor from './WorkflowFormInputEditor'
import WorkflowFormFillEditor from './WorkflowFormFillEditor'
import WorkflowFileWriteFields from './WorkflowFileWriteFields'
import WorkflowShellCommandFields from './WorkflowShellCommandFields'
import WorkflowRetryFields from './WorkflowRetryFields'
import WorkflowForEachFields from './WorkflowForEachFields'
import WorkflowHttpRequestFields from './WorkflowHttpRequestFields'
import WorkflowCallNodeFields from './WorkflowCallNodeFields'
import { normalizeHttpRequestData } from '../../../../shared/workflow-http-request-defaults'
import {
  applyNodeEdit,
  getNodeRetryConfig,
  nodeTypeSupportsRetry,
  parseRetryConfig
} from '../../../../shared/workflow-node-retry'
import { NODE_TYPE_LABELS } from './workflow-canvas-node-config'
import { getMonacoFields, coerceNodeData, getGenericFieldKeys } from './workflow-node-editor-config'
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
  const [retryValues, setRetryValues] = useState(() => {
    const r = node ? getNodeRetryConfig(node) : parseRetryConfig()
    return { retryCount: String(r.retryCount), retryDelaySeconds: String(r.retryDelaySeconds) }
  })

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

  const isHttpRequest = node?.type === 'http_request'
  const [httpData, setHttpData] = useState(() => normalizeHttpRequestData(node?.data))

  const isAgentCall = node?.type === 'agent_call'
  const isShellCommand = node?.type === 'shell_command'
  const isPythonScript = node?.type === 'python_script'
  const isFileWrite = node?.type === 'file_write'
  const isForEach = node?.type === 'for_each'
  const isCollect = node?.type === 'collect'
  const isTriggerManual = node?.type === 'trigger_manual'
  const isWorkflowCall = node?.type === 'workflow_call'
  const isRemote = workflow.executionTargetType === 'ssh'

  const [formMode, setFormMode] = useState<'fill' | 'edit'>('fill')

  const { steps, resolveExpr } = useLastRunSteps(workflow.id)

  const parentEdge = isBranchNode
    ? workflow.edges.find((e) => e.targetNodeId === nodeId)
    : undefined
  const parentStep = parentEdge ? steps[parentEdge.sourceNodeId] : undefined
  const parentNodeLastRun = parentStep
    ? (() => {
        let exitCode: number | null = null
        try {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON.parse returns unknown; shape verified by optional chaining
          const parsed = JSON.parse(parentStep.output) as { exitCode?: number } | null
          exitCode = parsed?.exitCode ?? null
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
        : isHttpRequest
          ? httpData
          : coerceNodeData(localData)
    const updatedNodes = workflow.nodes.map((n) =>
      n.id === nodeId
        ? { ...applyNodeEdit(n, nodeDataPatch, retryValues), label: nodeLabel || undefined }
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
    isHttpRequest,
    httpData,
    retryValues,
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
  const hasRetry = nodeTypeSupportsRetry(node.type)

  const genericFields = getGenericFieldKeys(Object.keys(localData), node.type)

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
        <div className="flex items-center gap-0.5">
          {isFormInput && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => setFormMode((m) => (m === 'fill' ? 'edit' : 'fill'))}
              title={
                formMode === 'fill'
                  ? translate('workflows.nodeEditor.editFields', 'Edit fields')
                  : translate('workflows.nodeEditor.fillValues', 'Fill values')
              }
            >
              {formMode === 'fill' ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-6" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-sleek p-3 space-y-3">
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

        {(isShellCommand || isPythonScript) && (
          <WorkflowShellCommandFields
            showShellSelector={isShellCommand}
            isRemote={isRemote}
            localData={localData}
            onDataChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
          />
        )}

        {isFileWrite && (
          <WorkflowFileWriteFields
            localData={localData}
            onDataChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
          />
        )}

        {isHttpRequest && (
          <WorkflowHttpRequestFields data={httpData} onChange={setHttpData} exprHint={exprHint} />
        )}

        {isForEach && (
          <WorkflowForEachFields
            localData={localData}
            onDataChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
            exprHint={exprHint}
          />
        )}

        {isWorkflowCall && (
          <WorkflowCallNodeFields
            localData={localData}
            onDataChange={(patch) => setLocalData((prev) => ({ ...prev, ...patch }))}
            currentWorkflowId={workflow.id}
          />
        )}

        {isBranchNode && (
          <WorkflowBranchConditionEditor
            initialConditions={branchValues.conditions}
            initialDefaultLabel={branchValues.defaultLabel}
            onChange={(conditions, defaultLabel) => setBranchValues({ conditions, defaultLabel })}
            parentNodeLastRun={parentNodeLastRun}
            resolveExpr={resolveExpr}
          />
        )}

        {isFormInput &&
          (formMode === 'fill' ? (
            <WorkflowFormFillEditor fields={formFields} onChange={setFormFields} />
          ) : (
            <WorkflowFormInputEditor
              initialFields={formFields}
              onChange={setFormFields}
              resolveExpr={resolveExpr}
            />
          ))}

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
            retryCount={retryValues.retryCount}
            retryDelaySeconds={retryValues.retryDelaySeconds}
            onChange={(patch) => setRetryValues((prev) => ({ ...prev, ...patch }))}
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
