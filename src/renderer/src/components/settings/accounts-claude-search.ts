import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getAccountsClaudeSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.accounts.search.75682e1b62', 'Claude Accounts'),
    description: translate(
      'auto.components.settings.accounts.search.dd75a73991',
      'Optional account switching for Claude while preserving shared chat context.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.accounts.search.e14049e1a8', 'claude'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.06662af91e', 'account'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.5b3f18ef4a', 'switch'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.8b06729e0f', 'active'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.86edc96bc9',
        'status bar'
      ),
      ...translateSearchKeyword('auto.components.settings.accounts.search.c759741d77', 'quota'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.f2d666a886', 'optional')
    ]
  },
  {
    title: translate(
      'accounts.claude.moveIdleSessions',
      'Move idle sessions to the selected account'
    ),
    description: translate(
      'accounts.claude.moveIdleSessionsDescription',
      'After you switch accounts, a Claude session still on the old one reopens its conversation on the selected account once it has sat idle for a minute in a tab you are not looking at.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.accounts.search.e14049e1a8', 'claude'),
      ...translateSearchKeyword('accounts.claude.keyword.move', 'move'),
      ...translateSearchKeyword('accounts.claude.keyword.resume', 'resume')
    ]
  }
])
