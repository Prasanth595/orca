import { createElement } from 'react'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import type { PlaneComposerItem } from './open-plane-work-item-composer'
import { PlaneCreateWorkspaceButton } from './PlaneCreateWorkspaceButton'

/** Row and detail action slots of the Plane task view, both rendering the create-workspace action. */
export function planeCreateWorkspaceActionSlots(sourceContext: TaskSourceContext | null): {
  renderRowActions: (item: PlaneComposerItem) => React.ReactNode
  renderDetailActions: (item: PlaneComposerItem) => React.ReactNode
} {
  return {
    renderRowActions: (item) => createElement(PlaneCreateWorkspaceButton, { item, sourceContext }),
    // Why the detail's item: it carries the description the linked workspace context needs.
    renderDetailActions: (item) =>
      createElement(PlaneCreateWorkspaceButton, { item, sourceContext, variant: 'labelled' })
  }
}
