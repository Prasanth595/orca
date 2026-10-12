import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'
import { translate } from '@/i18n/i18n'
import { InlineUsageBars } from '../status-bar/InlineProviderUsage'

export function AccountUsageReading({
  reading
}: {
  reading: InactiveAccountUsage | null
}): React.JSX.Element {
  const limits = reading?.rateLimits
  const hasWindows = Boolean(limits?.session || limits?.weekly || limits?.fableWeekly)
  const fetching = reading?.isFetching || limits?.status === 'fetching'
  return (
    <div
      className="w-full space-y-1 pt-1 text-xs text-muted-foreground"
      aria-busy={fetching || undefined}
    >
      {hasWindows && limits ? <InlineUsageBars limits={limits} isFetching={false} /> : null}
      {fetching ? (
        <span>{translate('accounts.usage.loading', 'Checking usage…')}</span>
      ) : limits?.status === 'error' || limits?.status === 'unavailable' ? (
        <span>{translate('accounts.usage.unavailable', 'Usage unavailable')}</span>
      ) : !hasWindows ? (
        <span>{translate('accounts.usage.notReported', 'Usage not reported')}</span>
      ) : null}
      {hasWindows && limits && limits.updatedAt > 0 ? (
        <div>
          {translate('accounts.usage.checkedAt', 'Last reported: {{time}}', {
            time: new Date(limits.updatedAt).toLocaleString()
          })}
        </div>
      ) : null}
    </div>
  )
}
