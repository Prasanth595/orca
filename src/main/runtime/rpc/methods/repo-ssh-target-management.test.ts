import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'
import { REPO_METHODS } from './repo'
import {
  RUNTIME_CAPABILITIES,
  WORKTREE_VISIBILITY_DEFAULTS_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY } from '../../../../shared/ssh-target-management'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('repo SSH target management RPC methods', () => {
  it('advertises server SSH target management so clients can gate the remote project flow', () => {
    expect(RUNTIME_CAPABILITIES).toContain(SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY)
  })

  // Harvested from the community PR #8492 by @jae-heo.
  it('adds an existing folder on one of the server SSH targets as a project', async () => {
    const repo = {
      id: 'repo-p8',
      path: '/srv/project',
      displayName: 'project',
      badgeColor: '#737373',
      addedAt: 1,
      connectionId: 'ssh-p8',
      kind: 'git' as const
    }
    const runtime = new OrcaRuntimeService(null)
    const addSshRepo = vi.spyOn(runtime, 'addSshRepo').mockResolvedValue(repo)
    const addRepo = vi.spyOn(runtime, 'addRepo')
    const dispatcher = new RpcDispatcher({ runtime, methods: REPO_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('repo.addRemote', { connectionId: 'ssh-p8', remotePath: '/srv/project' }),
      { clientCapabilities: [WORKTREE_VISIBILITY_DEFAULTS_RUNTIME_CAPABILITY] }
    )

    expect(addSshRepo).toHaveBeenCalledWith({ connectionId: 'ssh-p8', remotePath: '/srv/project' })
    expect(addRepo).not.toHaveBeenCalled()
    expect(response).toMatchObject({ ok: true, result: { repo: { connectionId: 'ssh-p8' } } })
  })

  it('refuses a remote project without an SSH target rather than adding a server path', async () => {
    const runtime = new OrcaRuntimeService(null)
    const addSshRepo = vi.spyOn(runtime, 'addSshRepo')
    const dispatcher = new RpcDispatcher({ runtime, methods: REPO_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('repo.addRemote', { remotePath: '/srv/project' })
    )

    expect(response).toMatchObject({ ok: false })
    expect(addSshRepo).not.toHaveBeenCalled()
  })
})
