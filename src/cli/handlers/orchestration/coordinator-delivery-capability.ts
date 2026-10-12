import { RuntimeClientError, type RuntimeClient } from '../../runtime-client'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY } from '../../../shared/orchestration-coordinator-delivery'

export async function assertCoordinatorDeliverySupported(client: RuntimeClient): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The connected Orca runtime does not support coordination delivery. No effects were applied.'
    )
  }
}
