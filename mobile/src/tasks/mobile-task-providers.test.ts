import { describe, expect, it } from 'vitest'
import { TASK_PROVIDERS } from '../../../src/shared/task-providers'
import { isMobileSupportedTaskProvider } from './mobile-task-providers'

describe('isMobileSupportedTaskProvider', () => {
  it('keeps every provider mobile can list and drops Plane', () => {
    expect(TASK_PROVIDERS.filter(isMobileSupportedTaskProvider)).toEqual([
      'github',
      'gitlab',
      'linear',
      'jira'
    ])
    expect(isMobileSupportedTaskProvider('plane')).toBe(false)
  })
})
