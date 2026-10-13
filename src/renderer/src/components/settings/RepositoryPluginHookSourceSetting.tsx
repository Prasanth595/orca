import { AlertTriangle } from 'lucide-react'
import type { PluginHookSource } from '../../../../shared/orca-yaml-hook-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { PluginWorktreeHookCommands } from './PluginWorktreeHookConsentPreview'
import {
  pluginHookSourceValue,
  type PluginWorktreeHookOption
} from './plugin-worktree-hook-options'

const OWN_SCRIPTS_VALUE = 'own-scripts'

export function RepositoryPluginHookSourceSetting({
  selected,
  options,
  sectionId,
  onSelect
}: {
  selected: PluginHookSource | undefined
  /** Scroll target for "local commands" links while the script fields are hidden. */
  sectionId?: string
  options: readonly PluginWorktreeHookOption[]
  onSelect: (source: PluginHookSource | undefined) => void
}): React.JSX.Element {
  const selectedValue = selected ? pluginHookSourceValue(selected) : OWN_SCRIPTS_VALUE
  const selectedOption = selected
    ? options.find((option) => option.value === selectedValue)
    : undefined
  // Offer only plugins Orca would run, but keep a stale pick visible so it can be switched off.
  const choices = options.filter((option) => option.available || option.value === selectedValue)
  const unavailable = selected !== undefined && !selectedOption?.available

  return (
    <div id={sectionId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Label>
            {translate(
              'auto.components.settings.RepositoryPluginHookSourceSetting.label',
              'Local Hook Commands'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryPluginHookSourceSetting.description',
              'Use the setup and archive scripts below, or the commands a plugin provides.'
            )}
          </p>
        </div>
        <Select
          value={selectedValue}
          onValueChange={(value) =>
            onSelect(
              value === OWN_SCRIPTS_VALUE
                ? undefined
                : options.find((option) => option.value === value)?.source
            )
          }
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OWN_SCRIPTS_VALUE}>
              {translate(
                'auto.components.settings.RepositoryPluginHookSourceSetting.ownScripts',
                'My scripts'
              )}
            </SelectItem>
            {choices.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {`${option.pluginName} · ${option.hook.title}`}
              </SelectItem>
            ))}
            {selected && !selectedOption ? (
              <SelectItem value={selectedValue}>
                {translate(
                  'auto.components.settings.RepositoryPluginHookSourceSetting.removedPlugin',
                  '{{value0}} (not installed)',
                  { value0: selected.pluginKey }
                )}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      {unavailable ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {translate(
            'auto.components.settings.RepositoryPluginHookSourceSetting.unavailable',
            'This plugin is disabled, removed or waiting for your approval, so no local hook commands run for this project. Your own scripts stay off until you switch back to them.'
          )}
        </p>
      ) : null}
      {selectedOption ? <PluginWorktreeHookCommands hook={selectedOption.hook} /> : null}
    </div>
  )
}
