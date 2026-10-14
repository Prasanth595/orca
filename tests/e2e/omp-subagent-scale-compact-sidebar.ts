import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { nativeChildren, type ScaleRoot } from './omp-subagent-scale-roots'
import { worktreeRow } from './worktree-row-locators'

export { captureCompact, proveCompact }
async function captureCompact(page: Page, worktreeId: string, info: TestInfo, name: string) {
  // Crop to the existing agent surface: no account footer, host, username or project path.
  const file = info.outputPath(`${name}.png`)
  await worktreeRow(page, worktreeId)
    .locator('[data-compact-agent-list]')
    .screenshot({ path: file, animations: 'disabled' })
  await info.attach(name, { path: file, contentType: 'image/png' })
}

async function readCompactAgentLayout(surface: Locator) {
  return surface.evaluate((element) => {
    const rows = [...element.querySelectorAll<HTMLElement>('.agent-disclosure-row')]
    let exposed = 0
    let painted = 0
    for (const row of rows) {
      if (row.closest('[aria-hidden="true"], [inert]')) {
        continue
      }
      exposed++
      const rect = row.getBoundingClientRect()
      let top = rect.top
      let bottom = rect.bottom
      let left = rect.left
      let right = rect.right
      let hidden = false
      for (
        let parent: HTMLElement | null = row;
        parent && parent !== element;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent)
        if (
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          Number(style.opacity) === 0
        ) {
          hidden = true
        }
        const bounds = parent.getBoundingClientRect()
        if (style.overflowY === 'clip' || style.overflowY === 'hidden') {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
        if (style.overflowX === 'clip' || style.overflowX === 'hidden') {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
      }
      // Count whole rows inside this compact surface, not just the sidebar's scroll viewport.
      if (!hidden && rect.height > 0 && bottom - top >= rect.height - 0.5 && right > left) {
        painted++
      }
    }
    return { mounted: rows.length, exposed, painted }
  })
}

async function expectMountedNativeBranches(page: Page, rows: Locator, roots: ScaleRoot[]) {
  const branches = []
  for (const root of roots) {
    const rootRow = rows.filter({
      has: page.locator('span[title]').filter({ hasText: root.label })
    })
    await expect(rootRow).toHaveCount(1)
    const expansion = rootRow.locator('xpath=following-sibling::*[1]')
    await expect(expansion).toHaveClass(/compact-agent-expansion-grid/)
    const children = expansion.locator('.worktree-agent-lineage-children > .agent-disclosure-row')
    const nativeIds = nativeChildren(root)
      .map((ref) => ref.id)
      .sort()
    expect(nativeIds).toHaveLength(root.names.length)
    await expect(children).toHaveCount(root.names.length)
    await expect
      .poll(() =>
        children
          .locator('span[title]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')).sort())
      )
      .toEqual(nativeIds.map((id) => `${id} - status-smoke`).sort())
    branches.push({
      paneKey: root.paneKey,
      nativeSessionId: root.native.sessionId,
      nativeRootId: root.native.id,
      label: root.label,
      childIds: nativeIds
    })
  }
  return branches
}

async function proveCompact(page: Page, roots: ScaleRoot[], info: TestInfo) {
  const surface = worktreeRow(page, roots[0]!.worktreeId).locator('[data-compact-agent-list]')
  const summary = surface.locator('button.compact-agent-summary-button')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  // Existing policy shows one icon per distinct agent type, up to three; all roots here are OMP.
  const visibleRootIcons = await summary.locator('span.inline-flex.size-4').count()
  expect(visibleRootIcons).toBe(1)
  await expect(summary).toContainText(`+${roots.length - visibleRootIcons}`)
  await expect.poll(() => readCompactAgentLayout(surface)).toMatchObject({ exposed: 0, painted: 0 })
  await captureCompact(page, roots[0]!.worktreeId, info, 'native-scale-compact-overflow')
  const started = performance.now()
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const rows = surface.locator('.agent-disclosure-row')
  const mountedCount = roots.reduce((count, root) => count + root.names.length + 1, 0)
  await expect(rows).toHaveCount(mountedCount)
  await expect
    .poll(() => readCompactAgentLayout(surface))
    .toEqual({
      mounted: mountedCount,
      exposed: mountedCount,
      painted: mountedCount
    })
  const nativeBranches = await expectMountedNativeBranches(page, rows, roots)
  const expandMs = performance.now() - started
  const firstRoot = rows.filter({
    has: page.locator('span[title]').filter({ hasText: roots[0]!.label })
  })
  const expansion = firstRoot.locator('xpath=following-sibling::*[1]')
  const disclosure = firstRoot.locator('[data-agent-child-disclosure-button]')
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(expansion).toHaveAttribute('aria-hidden', 'true')
  await expect(expansion).toHaveJSProperty('inert', true)
  await expect.poll(() => expansion.evaluate((node) => node.getBoundingClientRect().height)).toBe(0)
  const collapsedGeometry = await expansion.evaluate((node) => {
    const clip = node.firstElementChild!
    return {
      gridHeight: node.getBoundingClientRect().height,
      clipHeight: clip.getBoundingClientRect().height,
      clipOverflowY: getComputedStyle(clip).overflowY
    }
  })
  expect(collapsedGeometry).toEqual({ gridHeight: 0, clipHeight: 0, clipOverflowY: 'clip' })
  // The animation intentionally retains all native rows in the DOM; hidden descendants are not painted.
  await expect(rows).toHaveCount(mountedCount)
  const paintedCount = mountedCount - roots[0]!.names.length
  await expect
    .poll(() => readCompactAgentLayout(surface))
    .toEqual({
      mounted: mountedCount,
      exposed: paintedCount,
      painted: paintedCount
    })
  const collapsedLayout = await readCompactAgentLayout(surface)
  await expectMountedNativeBranches(page, rows, roots)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(expansion).toHaveAttribute('aria-hidden', 'false')
  await expect(expansion).toHaveJSProperty('inert', false)
  await expect
    .poll(() => readCompactAgentLayout(surface))
    .toEqual({
      mounted: mountedCount,
      exposed: mountedCount,
      painted: mountedCount
    })
  await expectMountedNativeBranches(page, rows, roots)
  await captureCompact(page, roots[0]!.worktreeId, info, 'native-scale-compact-expanded')
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(() => readCompactAgentLayout(surface))
    .toEqual({
      mounted: mountedCount,
      exposed: 0,
      painted: 0
    })
  return {
    expandMs,
    rootCount: roots.length,
    childCount: roots.length * roots[0]!.names.length,
    collapsedIconLimit: 3,
    visibleRootIcons,
    hiddenRootIcons: roots.length - visibleRootIcons,
    nativeRosterDisplayCap: 32,
    nativeBranches,
    collapsedLayout,
    collapsedGeometry
  }
}
