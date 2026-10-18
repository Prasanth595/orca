import { useState } from 'react'
import { GitBranch, Globe2, HardDrive, ListChecks, Workflow, type LucideIcon } from 'lucide-react'
import {
  WORKFLOWS_SKILL_INSTALL_COMMAND,
  WORKFLOWS_SKILL_NAME
} from '@/lib/agent-feature-install-commands'
import type { SkillUsageExample } from '@/lib/skill-usage-example'
import { getWorkflowsUsageExamples } from '@/lib/workflows-usage-examples'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { useAppStore } from '../../store'
import { getWorkflowsSkillPaneSearchEntries } from './workflows-skill-search'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import { buildSkillCommandForRuntime } from './CliSkillRuntimeSetup'
import { OrchestrationSkillAgentCoverage } from './OrchestrationSkillAgentCoverage'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { OrchestrationSkillPromptDialog } from './OrchestrationSkillPromptDialog'
import { translate } from '@/i18n/i18n'

const EXAMPLE_ICONS: Record<string, LucideIcon> = {
  'disk-space': HardDrive,
  'import-graph': ListChecks,
  'run-record': Workflow,
  'remote-host': Globe2
}

function resolveWorkflowsExampleIcon(example: SkillUsageExample): LucideIcon {
  return EXAMPLE_ICONS[example.id] ?? GitBranch
}

export function WorkflowsSkillPane(): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const searchEntries = getWorkflowsSkillPaneSearchEntries()
  const showWorkflows = matchesSettingsSearch(searchQuery, searchEntries)
  const [skillPromptOpen, setSkillPromptOpen] = useState(false)
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const workflowsInstallCommand = !activeSkillRuntime.installDisabledReason
    ? buildSkillCommandForRuntime(WORKFLOWS_SKILL_INSTALL_COMMAND, activeSkillRuntime.agentRuntime)
    : WORKFLOWS_SKILL_INSTALL_COMMAND

  const {
    installed: workflowsSkillDetected,
    loading: workflowsSkillLoading,
    error: workflowsSkillError,
    skills: discoveredSkills,
    sources: discoveredSkillSources,
    refresh: refreshWorkflowsSkill
  } = useInstalledAgentSkill(WORKFLOWS_SKILL_NAME, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  if (!showWorkflows) {
    return <div />
  }

  return (
    <SearchableSetting
      title={translate('auto.components.settings.WorkflowsSkillPane.title', 'Workflows')}
      description={translate(
        'auto.components.settings.WorkflowsSkillPane.description',
        'Automate chains of steps — shell commands, agent calls, HTTP requests, branches, and loops — that Orca runs for you.'
      )}
      keywords={searchEntries[0].keywords}
      forceVisible
      className="space-y-5 py-2"
    >
      <AgentSkillSetupPanel
        title={translate(
          'auto.components.settings.WorkflowsSkillPane.skillTitle',
          'Workflows skill'
        )}
        description={translate(
          'auto.components.settings.WorkflowsSkillPane.skillDescription',
          'Enables agents to create, run, and inspect Orca Agent Workflows through the orca CLI.'
        )}
        command={workflowsInstallCommand}
        terminalTitle="Workflows setup"
        terminalAriaLabel="Workflows skill install terminal"
        terminalWorktreeId="settings-workflows-skill-terminal"
        terminalShellOverride={activeSkillRuntime.terminalShellOverride}
        terminalRuntime={activeSkillRuntime.agentRuntime}
        installed={workflowsSkillDetected}
        loading={workflowsSkillLoading}
        error={activeSkillRuntime.installDisabledReason ?? workflowsSkillError}
        installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
        icon={<Workflow className="size-5" />}
        onBeforeOpenTerminal={() => {
          useAppStore.getState().recordFeatureInteraction('agent-workflows-setup')
        }}
        actionHint={
          // Installed updates stay on the primary panel so there is only one update path.
          activeSkillRuntime.installDisabledReason || workflowsSkillDetected ? null : (
            <p className="text-[12px] leading-snug text-muted-foreground">
              {translate(
                'auto.components.settings.WorkflowsSkillPane.preferOwnTerminal',
                'Prefer your own terminal?'
              )}{' '}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setSkillPromptOpen(true)
                }}
              >
                {translate(
                  'auto.components.settings.WorkflowsSkillPane.copyInstallCommand',
                  'Copy install command'
                )}
              </button>
            </p>
          )
        }
        footer={
          <OrchestrationSkillAgentCoverage
            embedded
            skillName={WORKFLOWS_SKILL_NAME}
            skills={discoveredSkills}
            sources={discoveredSkillSources}
            loading={workflowsSkillLoading}
          />
        }
        onRecheck={refreshWorkflowsSkill}
        freshnessSkillName={
          activeSkillRuntime.canUseLocalSkillFreshness ? WORKFLOWS_SKILL_NAME : undefined
        }
      />

      <OrchestrationSkillPromptDialog
        command={workflowsInstallCommand}
        open={skillPromptOpen}
        onOpenChange={setSkillPromptOpen}
        title={translate(
          'auto.components.settings.WorkflowsSkillPane.installDialogTitle',
          'Install workflows skill'
        )}
        description={translate(
          'auto.components.settings.WorkflowsSkillPane.installDialogDescription',
          'Run this command in a terminal to install the workflows skill for your agents.'
        )}
        copyAriaLabel={translate(
          'auto.components.settings.WorkflowsSkillPane.installDialogCopyAria',
          'Copy workflows skill install command'
        )}
      />

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.WorkflowsSkillPane.usageHeading',
          'How to use it'
        )}
        description={translate(
          'auto.components.settings.WorkflowsSkillPane.usageDescription',
          'Ask agents and Orca Chat to use workflows for saved automation graphs, imported step graphs, run records, and SSH targets.'
        )}
        examples={getWorkflowsUsageExamples()}
        resolveIcon={resolveWorkflowsExampleIcon}
        slashCommand={`/${WORKFLOWS_SKILL_NAME}`}
      />
    </SearchableSetting>
  )
}
