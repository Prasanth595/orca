import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getEditorGoToDefinitionSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.experimental.search.editorGoToDefinition.title',
      'Go to definition'
    ),
    description: translate(
      'auto.components.settings.experimental.search.editorGoToDefinition.description',
      'Cmd/Ctrl-click in TypeScript and JavaScript files opens the definition, including packages in node_modules.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.editorGoToDefinition.definition',
        'definition'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.editorGoToDefinition.navigation',
        'navigation'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.editorGoToDefinition.import',
        'import'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.editorGoToDefinition.typescript',
        'typescript'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.editorGoToDefinition.javascript',
        'javascript'
      )
    ]
  }
}
