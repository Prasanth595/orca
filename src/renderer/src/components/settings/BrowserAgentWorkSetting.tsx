import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { refreshCodexUserDeveloperInstructions } from '@/lib/orca-browser-guidance-launch-options'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  getBrowserAgentWorkDescription,
  getBrowserAgentWorkSearchEntry,
  getBrowserAgentWorkTitle
} from './browser-agent-work-search'

type BrowserAgentWorkSettingProps = {
  settings: Pick<GlobalSettings, 'useOrcaBrowserForAgentWork'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserAgentWorkSetting({
  settings,
  updateSettings
}: BrowserAgentWorkSettingProps): React.JSX.Element {
  const title = getBrowserAgentWorkTitle()
  const description = getBrowserAgentWorkDescription()
  const enabled = settings.useOrcaBrowserForAgentWork === true

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={getBrowserAgentWorkSearchEntry().keywords}
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        checked={enabled}
        onChange={() => {
          if (!enabled) {
            refreshCodexUserDeveloperInstructions()
          }
          updateSettings({ useOrcaBrowserForAgentWork: !enabled })
        }}
      />
    </SearchableSetting>
  )
}
