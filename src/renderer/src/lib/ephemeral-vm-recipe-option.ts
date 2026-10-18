import type { OrcaVmRecipe } from '../../../shared/orca-yaml-hook-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { isGitRepoKind } from '../../../shared/repo-kind'
import type { Repo } from '../../../shared/repo-types'
import type {
  ProjectHostSetupOption,
  ReadyProjectHostSetupOption
} from './project-host-setup-options'
import type { WorktreeCreationRequest } from './pending-worktree-creation'

export type EphemeralVmRecipeOption = OrcaVmRecipe &
  (
    | { recipeId: string; source: ReadyProjectHostSetupOption }
    | { recipeId?: undefined; source?: undefined }
  )

export function getEphemeralVmRecipeSources(
  setups: readonly ProjectHostSetupOption[],
  repos: readonly Repo[]
): ReadyProjectHostSetupOption[] {
  return setups.filter((setup): setup is ReadyProjectHostSetupOption => {
    if (setup.kind !== 'ready' || parseExecutionHostId(setup.hostId)?.kind === 'ssh') {
      return false
    }
    return repos.some(
      (repo) =>
        repo.id === setup.repoId &&
        getRepoExecutionHostId(repo) === setup.hostId &&
        isGitRepoKind(repo) &&
        !repo.connectionId
    )
  })
}

export function bindEphemeralVmRecipe(
  recipe: OrcaVmRecipe,
  source: ReadyProjectHostSetupOption
): EphemeralVmRecipeOption {
  return {
    ...recipe,
    id: JSON.stringify([source.hostId, source.repoId, recipe.id]),
    recipeId: recipe.id,
    source
  }
}

export function buildEphemeralVmRecipeRequest(
  selectedId: string,
  recipes: readonly EphemeralVmRecipeOption[],
  repoId: string,
  projectId: string,
  executionHostId: string | null
): NonNullable<WorktreeCreationRequest['ephemeralVmRecipe']> {
  const recipe = recipes.find((option) => option.id === selectedId)
  if (!recipe) {
    throw new Error('The selected environment recipe is no longer available.')
  }
  if (
    recipe.source &&
    (recipe.source.repoId !== repoId ||
      recipe.source.hostId !== executionHostId ||
      recipe.source.projectId !== projectId)
  ) {
    throw new Error(
      'The selected environment recipe does not match the workspace host. Select it again.'
    )
  }
  const owner = parseExecutionHostId(recipe.source?.hostId ?? executionHostId)
  return {
    ...(owner?.kind === 'runtime' ? { ownerEnvironmentId: owner.environmentId } : {}),
    sourceRepoId: recipe.source?.repoId ?? repoId,
    recipeId: recipe.recipeId ?? recipe.id,
    projectId,
    ...(recipe.checkoutMode ? { checkoutMode: recipe.checkoutMode } : {})
  }
}
