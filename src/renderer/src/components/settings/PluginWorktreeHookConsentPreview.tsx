import type { PluginHostWorktreeHook } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'

export function worktreeHookPhaseLabel(phase: 'setup' | 'archive'): string {
  return phase === 'setup'
    ? translate('auto.components.settings.PluginWorktreeHookConsentPreview.setup', 'Setup')
    : translate('auto.components.settings.PluginWorktreeHookConsentPreview.archive', 'Archive')
}

/** Read-only setup/archive commands of one hook contribution. */
export function PluginWorktreeHookCommands({
  hook
}: {
  hook: PluginHostWorktreeHook
}): React.JSX.Element {
  return (
    <dl className="space-y-2">
      {(['setup', 'archive'] as const).map((phase) => {
        const command = hook[phase]?.trim()
        if (!command) {
          return null
        }
        const phaseLabel = worktreeHookPhaseLabel(phase)
        return (
          <div key={phase}>
            <dt className="mb-1 text-xs text-muted-foreground">{phaseLabel}</dt>
            <dd>
              <pre
                tabIndex={0}
                aria-label={translate(
                  'auto.components.settings.PluginWorktreeHookConsentPreview.commandLabel',
                  '{{value0}} · {{value1}} command',
                  { value0: hook.title, value1: phaseLabel }
                )}
                className="max-h-40 overflow-auto scrollbar-sleek whitespace-pre-wrap break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs leading-5 text-foreground"
              >
                {command}
              </pre>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export function PluginWorktreeHookConsentPreview({
  hooks
}: {
  hooks: readonly PluginHostWorktreeHook[]
}): React.JSX.Element | null {
  if (hooks.length === 0) {
    return null
  }
  return (
    <section className="space-y-3" aria-labelledby="plugin-worktree-hook-consent-heading">
      <h3
        id="plugin-worktree-hook-consent-heading"
        className="text-2xs font-semibold uppercase tracking-[0.05em] text-muted-foreground"
      >
        {translate(
          'auto.components.settings.PluginWorktreeHookConsentPreview.heading',
          'Worktree hook commands'
        )}
      </h3>
      <p className="text-xs leading-5 text-muted-foreground">
        {translate(
          'auto.components.settings.PluginWorktreeHookConsentPreview.scope',
          'These run in a worktree only for projects where you choose this plugin under Worktree Hooks.'
        )}
      </p>
      {hooks.map((hook) => (
        <div key={hook.id} className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{hook.title}</p>
          <PluginWorktreeHookCommands hook={hook} />
        </div>
      ))}
    </section>
  )
}
