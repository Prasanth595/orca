import { isAuthError, type LinearClientForWorkspace } from './client'
import { acquire, release } from './linear-request-concurrency'
import { clearToken } from './linear-token-store'
import {
  LinearAgentAccessError,
  classifyLinearError,
  linearError,
  linearMessage,
  linearRetryMetadata
} from './issue-context-errors'

export async function withLinearRead<T>(
  entry: LinearClientForWorkspace,
  read: () => Promise<T>,
  selection?: (string & {}) | 'all',
  signal?: AbortSignal
): Promise<T> {
  void selection
  await acquire(signal)
  try {
    signal?.throwIfAborted()
    return await read()
  } catch (error) {
    if (error instanceof LinearAgentAccessError) {
      throw error
    }
    const code = classifyLinearError(error)
    if (
      code === 'linear_auth_expired' ||
      (code !== 'linear_permission_denied' && code !== 'linear_rate_limited' && isAuthError(error))
    ) {
      clearToken(entry.workspace.id)
      throw linearError('linear_auth_expired', 'Linear authentication expired.', {
        nextSteps: ['Reconnect Linear from Orca settings.']
      })
    }
    throw linearError(code, linearMessage(error), linearRetryMetadata(error, code))
  } finally {
    release()
  }
}
