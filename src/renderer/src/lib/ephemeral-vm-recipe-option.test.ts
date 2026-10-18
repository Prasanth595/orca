import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { ReadyProjectHostSetupOption } from './project-host-setup-options'
import {
  bindEphemeralVmRecipe,
  buildEphemeralVmRecipeRequest,
  getEphemeralVmRecipeSources
} from './ephemeral-vm-recipe-option'

const local: ReadyProjectHostSetupOption = {
  id: 'local-setup',
  kind: 'ready',
  projectId: 'project',
  hostId: 'local',
  repoId: 'repo',
  label: 'Local Mac',
  detail: '',
  path: '/local/project'
}
const central: ReadyProjectHostSetupOption = {
  ...local,
  id: 'central-setup',
  hostId: 'runtime:central',
  label: 'Central Server',
  path: '/server/project'
}
const recipe = {
  id: 'worker',
  name: 'Worker VM',
  create: './create',
  checkoutMode: 'provisioned-root' as const
}

describe('owner-bound recipe choices', () => {
  it('keeps identical repo and recipe IDs on two hosts distinct', () => {
    const a = bindEphemeralVmRecipe(recipe, local)
    const b = bindEphemeralVmRecipe(recipe, central)
    expect(a.id).not.toBe(b.id)
    expect(
      buildEphemeralVmRecipeRequest(b.id, [a, b], 'repo', 'project', 'runtime:central')
    ).toEqual({
      ownerEnvironmentId: 'central',
      sourceRepoId: 'repo',
      recipeId: 'worker',
      projectId: 'project',
      checkoutMode: 'provisioned-root'
    })
    expect(
      buildEphemeralVmRecipeRequest(a.id, [a, b], 'repo', 'project', 'local')
    ).not.toHaveProperty('ownerEnvironmentId')
  })

  it('rejects stale choices and an owner mismatch instead of inferring another host', () => {
    const choice = bindEphemeralVmRecipe(recipe, central)
    expect(() => buildEphemeralVmRecipeRequest(choice.id, [], 'repo', 'project', 'local')).toThrow(
      'no longer available'
    )
    expect(() =>
      buildEphemeralVmRecipeRequest(choice.id, [choice], 'repo', 'project', 'local')
    ).toThrow('does not match')
    expect(() =>
      buildEphemeralVmRecipeRequest(choice.id, [choice], 'other-repo', 'project', 'runtime:central')
    ).toThrow('does not match')
  })

  it('preserves legacy local recipe requests', () => {
    expect(buildEphemeralVmRecipeRequest('worker', [recipe], 'repo', 'project', 'local')).toEqual({
      sourceRepoId: 'repo',
      recipeId: 'worker',
      projectId: 'project',
      checkoutMode: 'provisioned-root'
    })
  })

  it('admits only the matching native Git checkout for each source', () => {
    const repo: Repo = {
      id: 'repo',
      path: '/repo',
      displayName: 'project',
      badgeColor: '',
      addedAt: 1
    }
    const remote: Repo = { ...repo, executionHostId: 'runtime:central' }
    const ssh: ReadyProjectHostSetupOption = { ...central, hostId: 'ssh:target' }
    expect(getEphemeralVmRecipeSources([local, central, ssh], [repo, remote])).toEqual([
      local,
      central
    ])
    expect(getEphemeralVmRecipeSources([central], [repo])).toEqual([])
    expect(getEphemeralVmRecipeSources([central], [{ ...remote, kind: 'folder' }])).toEqual([])
    expect(
      getEphemeralVmRecipeSources([central], [{ ...remote, connectionId: 'nested-ssh' }])
    ).toEqual([])
  })
  it('rejects a project switch even when the source repo and host are unchanged', () => {
    const choice = bindEphemeralVmRecipe(recipe, central)
    expect(() =>
      buildEphemeralVmRecipeRequest(choice.id, [choice], 'repo', 'other-project', 'runtime:central')
    ).toThrow('does not match')
  })

  it('qualifies source repo identity independently of host and recipe IDs', () => {
    expect(bindEphemeralVmRecipe(recipe, central).id).not.toBe(
      bindEphemeralVmRecipe(recipe, { ...central, repoId: 'other-repo' }).id
    )
  })
})
