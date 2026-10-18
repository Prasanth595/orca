import {
  BROWSER_CLIENT_PROFILE_SWITCH_CAPABILITY,
  BrowserClientProfileMetadata
} from '../../../shared/browser-client-profile-switch-protocol'
import type { BrowserHostLeaseRegistry } from './browser-host-lease-registry'
import type { BrowserHostLeaseState } from './browser-host-lease-records'
import type {
  BrowserClientPageAuthority,
  BrowserHostPagePlacementRegistry
} from './browser-host-page-placement'
import {
  clientPageCreationTimeout,
  waitForClientPageCreationResult,
  closeUncommittedClientPage,
  type BrowserClientPageExecutionHostGrant
} from './browser-host-client-page-creation'

export async function switchBrowserHostClientProfile(
  authority: BrowserClientPageAuthority,
  metadata: BrowserClientProfileMetadata,
  input: {
    timeoutMs?: number
    registry: Pick<BrowserHostLeaseRegistry, 'requireClientPage' | 'select'>
    state: (clientId: string) => BrowserHostLeaseState
    placements: BrowserHostPagePlacementRegistry
    grants: Map<string, BrowserClientPageExecutionHostGrant>
  }
) {
  const timeoutMs = clientPageCreationTimeout(input.timeoutMs)
  const profile = BrowserClientProfileMetadata.parse(metadata)
  const expected = input.registry.requireClientPage(authority)
  const lease = input.registry.select(expected.browserHostClientId, [])
  if (
    !lease.hostCapabilities.includes(BROWSER_CLIENT_PROFILE_SWITCH_CAPABILITY) ||
    lease.browserHostGeneration !== expected.browserHostGeneration ||
    lease.pageReconciliationProtocolVersion !== 1
  ) {
    throw new Error('browser_host_profile_switch_unsupported')
  }
  const state = input.state(expected.browserHostClientId)
  const ledger = state.commandLedger
  const grant = input.grants.get(authority.browserPageId)
  if (!ledger || !grant || grant.placement !== expected) {
    throw new Error('browser_page_placement_stale')
  }
  const reservation = input.placements.reserveNewClientPage(authority.browserPageId, expected)
  let outcomeUnknown = false
  let completed = false
  try {
    const issued = ledger.issue({
      browserPageId: authority.browserPageId,
      pageHostGeneration: expected.pageHostGeneration,
      command: {
        type: 'switchProfile',
        profile,
        nextPageHostGeneration: reservation.placement.pageHostGeneration
      }
    })
    outcomeUnknown = true
    const result = await waitForClientPageCreationResult(issued.result, timeoutMs)
    outcomeUnknown = false
    completed = result.status === 'completed'
    if (result.status === 'failed') {
      throw new Error(result.errorCode)
    }
    input.registry.requireClientPage(authority)
    const placement = input.placements.commitClientPageReplacement(reservation, expected)
    ledger.advancePageGeneration(
      authority.browserPageId,
      expected.pageHostGeneration,
      placement.pageHostGeneration
    )
    input.grants.set(authority.browserPageId, { ...grant, placement })
    return placement
  } catch (error) {
    input.placements.cancelClientPageReservation(reservation)
    if (completed || outcomeUnknown) {
      // A timed-out switch may already have replaced the guest. Fence the old ledger
      // generation and close the replacement; authenticated inventory handles lost replies.
      try {
        ledger.retirePage(authority.browserPageId, expected.pageHostGeneration)
      } catch {
        // Concurrent retirement may have already removed or advanced this page.
      }
      closeUncommittedClientPage(state, authority.browserPageId, reservation.placement)
    }
    throw error
  }
}
