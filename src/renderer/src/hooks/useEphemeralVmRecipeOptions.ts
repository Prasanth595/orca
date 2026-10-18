import { useCallback, useEffect, useRef, useState } from 'react'
import { parseExecutionHostId } from '../../../shared/execution-host'
import {
  bindEphemeralVmRecipe,
  type EphemeralVmRecipeOption
} from '@/lib/ephemeral-vm-recipe-option'
import type { ReadyProjectHostSetupOption } from '@/lib/project-host-setup-options'

type EphemeralVmRecipeOptionsArgs = {
  enabled: boolean
  sources: readonly ReadyProjectHostSetupOption[]
  initialRecipeId?: string
}

export function useEphemeralVmRecipeOptions(args: EphemeralVmRecipeOptionsArgs): {
  recipes: EphemeralVmRecipeOption[]
  selectedRecipeId: string | null
  setSelectedRecipeId: (recipeId: string | null) => void
  error: string | null
} {
  const [recipes, setRecipes] = useState<EphemeralVmRecipeOption[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const pendingInitialRecipeId = useRef(args.initialRecipeId)
  const canLoad = args.enabled && args.sources.length > 0

  const load = useCallback((): void => {
    const generation = ++requestGeneration.current
    setRecipes([])
    setError(null)
    if (!canLoad) {
      setSelectedRecipeId(null)
      return
    }
    void Promise.allSettled(
      args.sources.map(async (source) => {
        const owner = parseExecutionHostId(source.hostId)
        const result = await window.api.ephemeralVm.listRecipes({
          repoId: source.repoId,
          ...(owner?.kind === 'runtime' ? { ownerEnvironmentId: owner.environmentId } : {})
        })
        if (result.status === 'error') {
          throw new Error(result.message ?? 'Recipe discovery failed')
        }
        return {
          recipes: (result.recipes ?? []).map((recipe) => bindEphemeralVmRecipe(recipe, source)),
          errors: (result.diagnostics ?? []).map(
            (diagnostic) =>
              `${source.label}: environmentRecipes[${diagnostic.index}]${diagnostic.field ? `.${diagnostic.field}` : ''}: ${diagnostic.message}`
          )
        }
      })
    ).then((results) => {
      if (generation !== requestGeneration.current) {
        return
      }
      const nextRecipes = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.recipes : []
      )
      setRecipes(nextRecipes)
      const initialId = pendingInitialRecipeId.current
      pendingInitialRecipeId.current = undefined
      const initial = nextRecipes.filter(
        (recipe) => recipe.id === initialId || recipe.recipeId === initialId
      )
      setSelectedRecipeId((current) => {
        if (current) {
          return nextRecipes.some((recipe) => recipe.id === current) ? current : null
        }
        return initial.length === 1 ? initial[0].id : null
      })
      const errors = results.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? result.value.errors
          : [
              `${args.sources[index].label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
            ]
      )
      setError(errors.join('\n') || null)
    })
  }, [args.sources, canLoad])

  useEffect(() => {
    load()
    return () => {
      requestGeneration.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!window.api.plugins?.onChanged) {
      return
    }
    return window.api.plugins.onChanged((event) => {
      if (event?.contentPacksChanged ?? true) {
        load()
      }
    })
  }, [load])

  return { recipes, selectedRecipeId, setSelectedRecipeId, error }
}
