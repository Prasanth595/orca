import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

const getAllWorkflowsSkillPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.workflows.search.title', 'Workflows'),
    description: translate(
      'auto.components.settings.workflows.search.description',
      'Install the skill that lets agents create, run, and inspect Orca Agent Workflows.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.workflows.search.workflow', 'workflow'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.workflows', 'workflows'),
      ...translateSearchKeyword(
        'auto.components.settings.workflows.search.agentWorkflow',
        'agent workflow'
      ),
      ...translateSearchKeyword('auto.components.settings.workflows.search.steps', 'steps'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.chain', 'chain steps'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.skill', 'skill'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.automate', 'automate'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.graph', 'graph'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.branch', 'branch'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.loop', 'loop'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.http', 'http request'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.ssh', 'ssh execution'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.cli', 'orca workflows'),
      ...translateSearchKeyword('auto.components.settings.workflows.search.examples', 'examples')
    ]
  }
])

export function getWorkflowsSkillPaneSearchEntries() {
  return getAllWorkflowsSkillPaneSearchEntries()
}
