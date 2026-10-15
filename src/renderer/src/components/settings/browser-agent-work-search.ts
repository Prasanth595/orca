import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export function getBrowserAgentWorkTitle(): string {
  return translate('settings.browser.agentWork.title', 'Use Orca Browser for Agent Work')
}

export function getBrowserAgentWorkDescription(): string {
  return translate(
    'settings.browser.agentWork.description',
    'New terminals open links from tools in an Orca browser tab, and new Claude and Codex launches are told to use the Orca browser. Applies to local terminals.'
  )
}

export const getBrowserAgentWorkSearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: getBrowserAgentWorkTitle(),
  description: getBrowserAgentWorkDescription(),
  keywords: [
    ...translateSearchKeyword('auto.components.settings.browser.search.2d2d995c58', 'browser'),
    ...translateSearchKeyword('auto.components.settings.browser.search.agentWork.agent', 'agent'),
    ...translateSearchKeyword('auto.components.settings.browser.search.agentWork.claude', 'claude'),
    ...translateSearchKeyword('auto.components.settings.browser.search.agentWork.codex', 'codex'),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.agentWork.terminal',
      'terminal'
    ),
    ...translateSearchKeyword('auto.components.settings.browser.search.agentWork.links', 'links'),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.agentWork.playwright',
      'playwright'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.agentWork.automation',
      'automation'
    )
  ]
}))
