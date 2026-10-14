// Scripted wire shapes from DSH d743267's ACP source, not a recording of a live model run.
import type { SessionConfigOption } from './generated/acp-protocol.generated'
import { acpLaunchSpecFor } from './acp-launch-specs'
import type { AcpScriptedAgent } from './acp-scripted-agent.test-support'
import { openAcpAdapterRig, PROVIDER_SESSION } from './acp-structured-adapter.test-support'

export const DSH = acpLaunchSpecFor('dsh')!
export const MODEL = 'opaque-provider-model-a'
export const DSH_CONFIG: SessionConfigOption[] = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: MODEL,
    options: [
      { value: MODEL, name: 'DeepSeek model A' },
      { value: 'opaque-provider-model-b', name: 'DeepSeek model B' }
    ]
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'high',
    options: [
      { value: '', name: 'Provider default' },
      { value: 'high', name: 'High' }
    ]
  }
]

export function installDshOptionWrites(agent: AcpScriptedAgent): void {
  let config = DSH_CONFIG
  agent.on('session/set_config_option', (frame) => {
    const params = frame.params
    if (
      !params ||
      typeof params !== 'object' ||
      !('configId' in params) ||
      !('value' in params) ||
      typeof params.value !== 'string'
    ) {
      throw new Error('missing config option')
    }
    const value = params.value
    config = config.map((option) =>
      option.type === 'select' && option.id === params.configId
        ? { ...option, currentValue: value }
        : option
    )
    agent.reply(frame, { configOptions: config })
  })
}

export function openDshRig(
  options: {
    resume?: boolean
    fullAccess?: boolean
    script?: (agent: AcpScriptedAgent) => void
  } = {}
) {
  return openAcpAdapterRig({
    spec: DSH,
    initialize: {
      authMethods: [],
      agentCapabilities: {
        mcpCapabilities: { http: true },
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {}, list: {}, resume: {} }
      }
    },
    launch: {
      fullAccess: options.fullAccess ?? false,
      ...(options.resume
        ? {
            resume: {
              sessionId: PROVIDER_SESSION,
              key: 'saved-dsh-key',
              mayBeUnsaved: () => false,
              unannouncedLosses: () => []
            }
          }
        : {})
    },
    script: (agent) => {
      agent.on('session/new', (frame) =>
        agent.reply(frame, { sessionId: PROVIDER_SESSION, configOptions: DSH_CONFIG })
      )
      agent.on('session/resume', (frame) => agent.reply(frame, { configOptions: DSH_CONFIG }))
      options.script?.(agent)
    }
  })
}

export function dshUpdate(update: unknown) {
  return { sessionId: PROVIDER_SESSION, update }
}

export const DSH_PERMISSION = {
  sessionId: PROVIDER_SESSION,
  toolCall: { toolCallId: 'call-1' },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
  ]
}
