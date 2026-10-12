import { describe, expect, it } from 'vitest'
import type { TabGroupLayoutNode, TabGroupSplitDirection } from '../tab-types'
import { equalizeSplitRunRatios } from './tab-group-layout-tree'

const leaf = (groupId: string): TabGroupLayoutNode => ({ type: 'leaf', groupId })

function split(
  direction: TabGroupSplitDirection,
  first: TabGroupLayoutNode,
  second: TabGroupLayoutNode,
  ratio?: number
): TabGroupLayoutNode {
  return { type: 'split', direction, first, second, ...(ratio === undefined ? {} : { ratio }) }
}

/** Effective ratios of the chain hanging off `second`, outermost first (absent means 0.5). */
function chainRatios(node: TabGroupLayoutNode): number[] {
  return node.type === 'split' ? [node.ratio ?? 0.5, ...chainRatios(node.second)] : []
}

describe.each(['horizontal', 'vertical'] as const)('equalizeSplitRunRatios (%s)', (direction) => {
  const cross = direction === 'horizontal' ? 'vertical' : 'horizontal'

  it.each([[[]], [['second']]])('makes three groups thirds from path %j', (path) => {
    // a | (b | c) at the default 50/25/25.
    const root = split(direction, leaf('a'), split(direction, leaf('b'), leaf('c')))

    expect(chainRatios(equalizeSplitRunRatios(root, path))).toEqual([1 / 3, 0.5])
  })

  it('makes four dragged groups quarters', () => {
    const root = split(
      direction,
      leaf('a'),
      split(direction, leaf('b'), split(direction, leaf('c'), leaf('d'), 0.8), 0.2),
      0.7
    )

    expect(chainRatios(equalizeSplitRunRatios(root, ['second']))).toEqual([1 / 4, 1 / 3, 0.5])
  })

  it('does not clamp an exact share to the drag range', () => {
    let root = leaf('g-7')
    for (let index = 6; index >= 1; index -= 1) {
      root = split(direction, leaf(`g-${index}`), root, 0.5)
    }

    expect(chainRatios(equalizeSplitRunRatios(root, []))[0]).toBe(1 / 7)
  })

  it('counts a first-side nested run by its groups', () => {
    const root = split(direction, split(direction, leaf('a'), leaf('b'), 0.9), leaf('c'), 0.5)

    const next = equalizeSplitRunRatios(root, ['first'])

    expect(next).toMatchObject({ ratio: 2 / 3, first: { ratio: 0.5 } })
  })

  it('leaves a cross-axis split inside the run alone', () => {
    const stacked = split(cross, leaf('b'), leaf('c'), 0.8)
    const root = split(direction, leaf('a'), stacked, 0.7)

    const next = equalizeSplitRunRatios(root, [])

    // The cross-axis split is one slot and keeps its identity.
    expect(next).toMatchObject({ ratio: 0.5 })
    expect(next.type === 'split' && next.second).toBe(stacked)
  })

  it('leaves the enclosing cross-axis run alone', () => {
    const untouched = leaf('a')
    const root = split(cross, untouched, split(direction, leaf('b'), leaf('c'), 0.8), 0.7)

    const next = equalizeSplitRunRatios(root, ['second'])

    expect(next).toMatchObject({ ratio: 0.7, second: { ratio: 0.5 } })
    expect(next.type === 'split' && next.first).toBe(untouched)
  })

  it('returns the same root when the run is already equal', () => {
    // A missing ratio means 0.5.
    const root = split(direction, leaf('a'), split(direction, leaf('b'), leaf('c')), 1 / 3)

    expect(equalizeSplitRunRatios(root, [])).toBe(root)
    expect(equalizeSplitRunRatios(root, ['second'])).toBe(root)
  })

  it.each([
    ['an unknown segment', ['left']],
    ['a path through a leaf', ['first', 'first']],
    ['a path ending on a leaf', ['first']]
  ])('returns the same root for %s', (_label, path) => {
    const root = split(direction, leaf('a'), split(direction, leaf('b'), leaf('c')), 0.7)

    expect(equalizeSplitRunRatios(root, path)).toBe(root)
  })
})

it('returns a leaf root unchanged', () => {
  const root = leaf('only')

  expect(equalizeSplitRunRatios(root, [])).toBe(root)
  expect(equalizeSplitRunRatios(root, ['first'])).toBe(root)
})
