import { translate } from '@/i18n/i18n'
import type { RuntimeCompatVerdict } from '../../../shared/protocol-compat'

/** The headline for a server this client cannot use; describeRuntimeCompatBlock gives the detail. */
export function runtimeCompatBlockTitle(
  reason: Extract<RuntimeCompatVerdict, { kind: 'blocked' }>['reason']
): string {
  return reason === 'server-too-old'
    ? translate(
        'auto.components.sidebar.HostSectionHeaderMenu.5b8b4b6a01',
        'Update server required'
      )
    : translate(
        'auto.components.sidebar.HostSectionHeaderMenu.9b3c1d2e44',
        'Update client required'
      )
}
