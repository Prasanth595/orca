import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import type { PlaneProject } from '../../../../shared/plane-types'
import type { PlaneScopeDraft } from './plane-connect-form-model'
import { PlaneOptionGroup } from './PlaneOptionGroup'

type ScopeMode = 'all' | 'selected'

function matchesQuery(project: PlaneProject, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    !needle ||
    project.name.toLowerCase().includes(needle) ||
    project.identifier.toLowerCase().includes(needle)
  )
}

/** "All projects" follows the live list; "Choose projects" with one checked is a single project. */
export function PlaneProjectScopePicker({
  projects,
  value,
  onChange,
  disabled = false
}: {
  projects: readonly PlaneProject[]
  value: PlaneScopeDraft
  onChange: (value: PlaneScopeDraft) => void
  disabled?: boolean
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const selectedIds = useMemo(
    () => new Set(value?.mode === 'selected' ? value.projectIds : []),
    [value]
  )
  const visibleProjects = projects.filter((project) => matchesQuery(project, query))

  const setSelected = (ids: readonly string[]): void =>
    onChange({ mode: 'selected', projectIds: [...ids] })
  const toggle = (projectId: string): void =>
    setSelected(
      selectedIds.has(projectId)
        ? [...selectedIds].filter((id) => id !== projectId)
        : // Keep the live list's order so the saved scope reads the same way.
          projects
            .map((project) => project.id)
            .filter((id) => id === projectId || selectedIds.has(id))
    )

  return (
    <div className="space-y-3">
      <PlaneOptionGroup<ScopeMode>
        label={translate('plane.scope.groupLabel', 'Which Plane projects Orca shows')}
        value={value?.mode ?? null}
        disabled={disabled}
        onChange={(mode) =>
          onChange(
            mode === 'all' ? { mode: 'all' } : { mode: 'selected', projectIds: [...selectedIds] }
          )
        }
        options={[
          {
            value: 'all',
            title: translate(
              'plane.scope.allTitle',
              'All projects (includes projects added later)'
            ),
            description: translate(
              'plane.scope.allDescription',
              'Every project this token can see, checked again on each refresh.'
            )
          },
          {
            value: 'selected',
            title: translate('plane.scope.chooseTitle', 'Choose projects'),
            description: translate(
              'plane.scope.chooseDescription',
              'Only the projects you check. Pick one to work in a single project.'
            )
          }
        ]}
      />
      {value?.mode === 'selected' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
              {translate('plane.scope.counter', '{{count}} of {{total}} selected', {
                count: selectedIds.size,
                total: projects.length
              })}
            </p>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled || projects.length === 0}
              onClick={() => setSelected(projects.map((project) => project.id))}
            >
              {translate('plane.scope.selectAll', 'Select all')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled || selectedIds.size === 0}
              onClick={() => setSelected([])}
            >
              {translate('plane.scope.selectNone', 'Select none')}
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <Command shouldFilter={false}>
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={translate('plane.scope.search', 'Search projects')}
              />
              <CommandList>
                <CommandEmpty>
                  {projects.length === 0
                    ? translate(
                        'plane.scope.noProjects',
                        'No projects are available to this token.'
                      )
                    : translate('plane.scope.noMatch', 'No projects match your search.')}
                </CommandEmpty>
                {visibleProjects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.id}
                    disabled={disabled}
                    onSelect={() => toggle(project.id)}
                  >
                    <Checkbox checked={selectedIds.has(project.id)} tabIndex={-1} />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="text-xs text-muted-foreground">{project.identifier}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </div>
        </div>
      ) : null}
    </div>
  )
}
