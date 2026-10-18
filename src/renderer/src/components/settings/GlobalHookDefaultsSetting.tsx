import { useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { EnvVarChips } from './RepositoryHookScriptSetting'
import { getRepositoryHookScriptTextareaRows } from '@/lib/script-textarea-rows'
import { translate } from '@/i18n/i18n'

function GlobalHookScriptField({
  label,
  description,
  value,
  placeholder,
  onCommit
}: {
  label: string
  description: string
  value: string
  placeholder: string
  onCommit: (next: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  useEffect(() => {
    setDraft(value)
    draftRef.current = value
  }, [value])
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h5 className="text-sm font-semibold">{label}</h5>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <textarea
        value={draft}
        aria-label={label}
        onChange={(event) => {
          draftRef.current = event.target.value
          setDraft(event.target.value)
        }}
        onBlur={() => {
          if (draftRef.current !== value) {
            onCommit(draftRef.current)
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        rows={getRepositoryHookScriptTextareaRows(draft)}
        className="w-full min-w-0 resize-y rounded-lg border border-input bg-muted/20 px-3 py-2 font-mono text-[12px] leading-[1.55] shadow-xs transition-[color,box-shadow] outline-none placeholder:italic placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
    </div>
  )
}

export function GlobalHookDefaultsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const defaults = settings.globalHookDefaults ?? { setup: '', archive: '' }
  const commit = (field: 'setup' | 'archive', next: string): void => {
    if (next === (defaults[field] ?? '')) {
      return
    }
    updateSettings({ globalHookDefaults: { ...defaults, [field]: next } })
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.GlobalHookDefaultsSetting.description',
          'Used only when a project has no local or shared script for that hook. A global default still asks for approval the first time it runs for a project.'
        )}
      </p>
      <EnvVarChips />
      <GlobalHookScriptField
        label={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.setup',
          'Setup Script'
        )}
        description={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.setupDescription',
          'Runs after a new worktree is created, when the project has no local or shared setup script.'
        )}
        value={defaults.setup ?? ''}
        placeholder={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.setupPlaceholder',
          'e.g. pnpm install'
        )}
        onCommit={(next) => commit('setup', next)}
      />
      <GlobalHookScriptField
        label={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.archive',
          'Archive Script'
        )}
        description={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.archiveDescription',
          'Runs before a worktree is archived, when the project has no local or shared archive script.'
        )}
        value={defaults.archive ?? ''}
        placeholder={translate(
          'auto.components.settings.GlobalHookDefaultsSetting.archivePlaceholder',
          'e.g. pnpm run clean'
        )}
        onCommit={(next) => commit('archive', next)}
      />
    </div>
  )
}
