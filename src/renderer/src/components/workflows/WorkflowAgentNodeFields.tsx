import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { WorkflowModel } from '../../../../preload/api/workflow-bridge'

function getKnownWorkflowAgents(): { value: TuiAgent; label: string }[] {
  return [
    { value: 'claude', label: translate('workflows.nodeEditor.agentClaude', 'Claude (claude -p)') },
    {
      value: 'cursor',
      label: translate('workflows.nodeEditor.agentCursor', 'Cursor (cursor-agent -p)')
    },
    {
      value: 'codex',
      label: translate('workflows.nodeEditor.agentCodex', 'Codex (codex --quiet)')
    },
    {
      value: 'gemini',
      label: translate('workflows.nodeEditor.agentGemini', 'Gemini (gemini -p)')
    },
    { value: 'amp', label: translate('workflows.nodeEditor.agentAmp', 'Amp (amp -p)') },
    {
      value: 'opencode',
      label: translate('workflows.nodeEditor.agentOpenCode', 'OpenCode (opencode -p)')
    }
  ]
}

type AgentDetect = { state: 'loading' } | { state: 'done'; agents: TuiAgent[] }
type ModelFetch =
  | { state: 'loading' }
  | { state: 'done'; models: WorkflowModel[] }
  | { state: 'error' }

type Props = {
  isRemote: boolean
  executionTargetId: string
  localData: Record<string, string>
  onDataChange: (patch: Record<string, string>) => void
}

export default function WorkflowAgentNodeFields({
  isRemote,
  executionTargetId,
  localData,
  onDataChange
}: Props): React.JSX.Element {
  const modelCache = useRef<Map<TuiAgent, ModelFetch>>(new Map())
  const [modelFetch, setModelFetch] = useState<ModelFetch>({ state: 'loading' })
  const [agentDetect, setAgentDetect] = useState<AgentDetect>({ state: 'loading' })

  const currentAgent = localData['agentId'] ?? 'claude'
  const isCustomAgent = currentAgent === 'custom'

  const currentAgentRef = useRef(currentAgent)
  const onDataChangeRef = useRef(onDataChange)
  // Keep refs current without mutating during render (concurrent-mode safe)
  useLayoutEffect(() => {
    currentAgentRef.current = currentAgent
    onDataChangeRef.current = onDataChange
  })

  useEffect(() => {
    const targetId = isRemote ? executionTargetId : undefined
    void window.api.workflows.detectAgents(targetId).then((agents) => {
      setAgentDetect({ state: 'done', agents })
      const cur = currentAgentRef.current
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: agents is TuiAgent[]; cur is a string that may equal a TuiAgent value; includes() requires the same type
      if (agents.length > 0 && cur !== 'custom' && !agents.includes(cur as TuiAgent)) {
        onDataChangeRef.current({ agentId: agents[0]!, model: '' })
      }
    })
  }, [isRemote, executionTargetId])

  useEffect(() => {
    if (isCustomAgent) {
      return
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: currentAgent is a TuiAgent when not 'custom'
    const agentKey = currentAgent as TuiAgent
    const cached = modelCache.current.get(agentKey)
    if (cached) {
      setModelFetch(cached)
      return
    }
    const loading: ModelFetch = { state: 'loading' }
    modelCache.current.set(agentKey, loading)
    setModelFetch(loading)
    void window.api.workflows
      .listModels(agentKey)
      .then((models) => {
        const done: ModelFetch = { state: 'done', models }
        modelCache.current.set(agentKey, done)
        setModelFetch((prev) => (prev === loading ? done : prev))
      })
      .catch(() => {
        const err: ModelFetch = { state: 'error' }
        modelCache.current.set(agentKey, err)
        setModelFetch((prev) => (prev === loading ? err : prev))
      })
  }, [isCustomAgent, currentAgent])

  const availableModels = modelFetch.state === 'done' ? modelFetch.models : []
  const selectedModel = localData['model'] ?? ''

  return (
    <>
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate('workflows.nodeEditor.agent', 'Agent')}
        </span>
        {agentDetect.state === 'loading' ? (
          <div className="flex items-center gap-1.5 h-7 text-[12px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>{translate('workflows.nodeEditor.detectingAgents', 'Detecting agents…')}</span>
          </div>
        ) : (
          <Select
            value={currentAgent}
            onValueChange={(v) => onDataChange({ agentId: v, model: '' })}
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agentDetect.agents.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  {translate(
                    'workflows.nodeEditor.noAgentsFound',
                    'No agents detected — using custom'
                  )}
                </div>
              )}
              {getKnownWorkflowAgents()
                .filter((a) => agentDetect.agents.includes(a.value))
                .map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              <SelectItem value="custom">
                {translate('workflows.nodeEditor.agentCustom', 'Custom executable…')}
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {isCustomAgent ? (
        <>
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {translate('workflows.nodeEditor.customExe', 'Executable')}
            </span>
            <input
              type="text"
              value={localData['customExecutable'] ?? ''}
              onChange={(e) => onDataChange({ customExecutable: e.target.value })}
              placeholder={translate(
                'workflows.nodeEditor.customExePlaceholder',
                '/usr/local/bin/myagent'
              )}
              className="w-full h-7 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {translate('workflows.nodeEditor.customArgs', 'Arg template')}
            </span>
            <input
              type="text"
              value={localData['customArgTemplate'] ?? ''}
              onChange={(e) => onDataChange({ customArgTemplate: e.target.value })}
              placeholder={translate(
                'workflows.nodeEditor.customArgsPlaceholder',
                '-p "{prompt}" -m sonnet-4.5'
              )}
              className="w-full h-7 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">
              {translate(
                'workflows.nodeEditor.customArgsHint',
                '{prompt} is replaced with the resolved prompt at run time.'
              )}
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {translate('workflows.nodeEditor.model', 'Model')}
          </span>
          {modelFetch.state === 'loading' && (
            <div className="flex items-center gap-1.5 h-7 text-[12px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>{translate('workflows.nodeEditor.loadingModels', 'Loading models…')}</span>
            </div>
          )}
          {modelFetch.state === 'error' && (
            <div className="h-7 flex items-center text-[12px] text-muted-foreground">
              {translate(
                'workflows.nodeEditor.modelsError',
                'Could not fetch models — enter manually'
              )}
            </div>
          )}
          {modelFetch.state === 'done' && availableModels.length === 0 && (
            <div className="h-7 flex items-center text-[12px] text-muted-foreground">
              {translate('workflows.nodeEditor.noModels', 'No models found for this agent')}
            </div>
          )}
          {modelFetch.state === 'done' && availableModels.length > 0 && (
            <Select
              value={selectedModel || '__default__'}
              onValueChange={(v) => onDataChange({ model: v === '__default__' ? '' : v })}
            >
              <SelectTrigger className="h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">
                  {translate('workflows.nodeEditor.modelDefault', 'Default')}
                </SelectItem>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </>
  )
}
