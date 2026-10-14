import { RuntimeClientError } from '../runtime-client'

export function getAutomationNotificationFlag(
  flags: Map<string, string | boolean>
): boolean | undefined {
  const value = flags.get('notify-on-failure')
  if (value === undefined) {
    return undefined
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new RuntimeClientError('invalid_argument', '--notify-on-failure must be true or false')
}
