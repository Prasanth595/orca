import { RuntimeClientError } from '../runtime-client'

export function getWorktreePinState(flags: Map<string, string | boolean>): boolean | undefined {
  const pin = flags.get('pin') === true
  const unpin = flags.get('unpin') === true
  if (pin && unpin) {
    throw new RuntimeClientError('invalid_argument', 'Choose either --pin or --unpin, not both.')
  }
  return pin ? true : unpin ? false : undefined
}
