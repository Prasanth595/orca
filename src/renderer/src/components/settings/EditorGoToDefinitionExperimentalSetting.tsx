import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { getExperimentalSearchEntry } from './experimental-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type EditorGoToDefinitionExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EditorGoToDefinitionExperimentalSetting({
  settings,
  updateSettings
}: EditorGoToDefinitionExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().editorGoToDefinition
  const enabled = settings.experimentalEditorGoToDefinition === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-editor-go-to-definition"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{entry.title}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.editorGoToDefinitionExperimentalSetting.copy',
              'Cmd/Ctrl-click a name in a TypeScript or JavaScript file to open the file that defines it, including packages in node_modules. Orca reads the files an open file imports in the background. Local workspaces only for now.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.editorGoToDefinitionExperimentalSetting.toggleLabel',
            'Toggle go to definition'
          )}
          onChange={() => updateSettings({ experimentalEditorGoToDefinition: !enabled })}
        />
      </div>
    </SearchableSetting>
  )
}
