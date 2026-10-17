import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { NumberField } from './SettingsFormControls'

// Same bounds as the terminal font size; editor zoom still clamps to 8-32 on top.
const MIN_EDITOR_FONT_SIZE = 10
const MAX_EDITOR_FONT_SIZE = 24

type EditorFontSizeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EditorFontSizeSetting({
  settings,
  updateSettings
}: EditorFontSizeSettingProps): React.JSX.Element {
  const title = translate(
    'auto.components.settings.EditorFontSizeSetting.title',
    'Editor Font Size'
  )
  const description = translate(
    'auto.components.settings.EditorFontSizeSetting.description',
    'Font size used by file editors and diff views. Leave empty to follow the terminal font size.'
  )

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['editor', 'font', 'size', 'text size', 'typography', 'code']}
    >
      <NumberField
        label={title}
        description={description}
        value={settings.editorFontSize}
        min={MIN_EDITOR_FONT_SIZE}
        max={MAX_EDITOR_FONT_SIZE}
        integer
        // The placeholder shows the terminal size an empty field follows.
        placeholder={String(settings.terminalFontSize)}
        suffix={translate('auto.components.settings.EditorFontSizeSetting.px', 'px')}
        onChange={(value) => updateSettings({ editorFontSize: value })}
        onClear={() => updateSettings({ editorFontSize: undefined })}
      />
    </SearchableSetting>
  )
}
