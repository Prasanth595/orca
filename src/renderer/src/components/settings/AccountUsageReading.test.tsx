import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it } from 'vitest'
import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'
import { i18n } from '@/i18n/i18n'
import { AccountUsageReading } from './AccountUsageReading'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

it('distinguishes unknown usage from an unused account', () => {
  const html = renderToStaticMarkup(<AccountUsageReading reading={null} />)
  expect(html).toContain('Usage not reported')
  expect(html).not.toContain('0%')
})

it('retains the last successful reading and its timestamp when a refresh fails', () => {
  const updatedAt = 1_800_000_000_000
  const reading: InactiveAccountUsage = {
    accountId: 'account-a',
    updatedAt,
    isFetching: false,
    rateLimits: {
      provider: 'codex',
      session: null,
      weekly: { usedPercent: 73, windowMinutes: 10080, resetsAt: null, resetDescription: null },
      status: 'error',
      error: 'Refresh failed',
      updatedAt
    }
  }
  const html = renderToStaticMarkup(<AccountUsageReading reading={reading} />)
  expect(html).toContain('73%')
  expect(html).toContain('Usage unavailable')
  expect(html).toContain('Last reported:')
  expect(html).toContain(new Date(updatedAt).toLocaleString())
})

it('announces an in-flight reading without fabricating a percentage', () => {
  const html = renderToStaticMarkup(
    <AccountUsageReading
      reading={{ accountId: 'account-a', rateLimits: null, updatedAt: 0, isFetching: true }}
    />
  )
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('Checking usage')
  expect(html).not.toContain('0%')
})
