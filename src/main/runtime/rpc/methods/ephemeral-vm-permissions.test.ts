import { expect, it } from 'vitest'
import { EPHEMERAL_VM_METHODS } from './ephemeral-vm'
import { denyRpcMethodForCaller, type RpcCallerScope } from '../rpc-caller-scope'

const untrustedScopes: RpcCallerScope[] = [
  { kind: 'mobile' },
  { kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: false },
  { kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true }
]

it.each(untrustedScopes)('refuses recipe lifecycle administration from $kind callers', (scope) => {
  for (const method of EPHEMERAL_VM_METHODS) {
    expect(
      denyRpcMethodForCaller(scope, method.name, method.permission),
      method.name
    ).not.toBeNull()
  }
})

it('allows the paired desktop and owner to manage recipes without desktop-control grants', () => {
  for (const method of EPHEMERAL_VM_METHODS) {
    expect(
      denyRpcMethodForCaller(
        { kind: 'runtime-paired', grants: [] },
        method.name,
        method.permission
      ),
      method.name
    ).toBeNull()
    expect(denyRpcMethodForCaller({ kind: 'owner' }, method.name, method.permission)).toBeNull()
  }
})
