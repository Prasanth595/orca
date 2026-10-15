import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getAccountsCodexSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.accounts.search.17c5d244eb', 'Codex Accounts'),
    description: translate(
      'auto.components.settings.accounts.search.b40d5b6570',
      'Optional account switching for Codex and live rate limit fetching.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.accounts.search.70d1b8def5', 'codex'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.06662af91e', 'account'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.e949b08ffb',
        'rate limit'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.86edc96bc9',
        'status bar'
      ),
      ...translateSearchKeyword('auto.components.settings.accounts.search.c759741d77', 'quota'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.f2d666a886', 'optional'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.77e32a2ad3',
        'reauthenticate'
      ),
      ...translateSearchKeyword('auto.components.settings.accounts.search.02c438bc7b', 'expired'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.042885c07c',
        'out of date'
      )
    ]
  },
  {
    title: translate('auto.components.settings.accounts.search.a4bcfd6f86', 'Active Codex Account'),
    description: translate(
      'auto.components.settings.accounts.search.87a4a8584e',
      'Choose which optional saved Codex account powers live quota reads.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.accounts.search.70d1b8def5', 'codex'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.06662af91e', 'account'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.5b3f18ef4a', 'switch'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.8b06729e0f', 'active'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.86edc96bc9',
        'status bar'
      ),
      ...translateSearchKeyword('auto.components.settings.accounts.search.f2d666a886', 'optional'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.35b461d817', 'sign in')
    ]
  },
  {
    title: translate('accounts.codex.autoSwitch', 'Switch accounts before a usage limit'),
    description: translate(
      'accounts.codex.autoSwitchDescription',
      'When the selected account passes 90% of its 5-hour or weekly limit, new Codex sessions start on the account with the most room left. Running sessions keep their account.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.accounts.search.70d1b8def5', 'codex'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.5b3f18ef4a', 'switch'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.e949b08ffb',
        'rate limit'
      ),
      ...translateSearchKeyword('auto.components.settings.accounts.search.c759741d77', 'quota'),
      ...translateSearchKeyword(
        'auto.components.settings.accounts.search.cursor.kw.usage',
        'usage'
      ),
      ...translateSearchKeyword('accounts.codex.keyword.auto', 'auto')
    ]
  }
])
