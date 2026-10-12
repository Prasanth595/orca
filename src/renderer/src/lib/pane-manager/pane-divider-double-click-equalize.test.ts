// @vitest-environment happy-dom
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { PaneLayoutEditIntent } from '../../../../shared/rpc-contract/session-tabs-schemas-params'
import { createDivider } from './pane-divider'

type Callbacks = {
  refitPanesUnder: Mock<(el: HTMLElement) => void>
  onLayoutChanged: Mock<(intent?: PaneLayoutEditIntent) => void>
}

function makePane(flex = '1 1 0%'): HTMLElement {
  const pane = document.createElement('div')
  pane.className = 'pane'
  pane.style.flex = flex
  return pane
}

/** Builds `[first][divider][second]` the way a split wraps one pane; returns the split and its divider. */
function makeSplit(
  callbacks: Callbacks,
  isVertical: boolean,
  first: HTMLElement,
  second: HTMLElement,
  flex = '1 1 0%'
): { split: HTMLElement; divider: HTMLElement } {
  const split = document.createElement('div')
  split.className = `pane-split ${isVertical ? 'is-vertical' : 'is-horizontal'}`
  split.style.flex = flex
  const divider = createDivider(isVertical, {}, callbacks)
  split.append(first, divider, second)
  return { split, divider }
}

function makeCallbacks(): Callbacks {
  return { refitPanesUnder: vi.fn(), onLayoutChanged: vi.fn() }
}

function doubleClick(divider: HTMLElement): void {
  divider.dispatchEvent(new MouseEvent('dblclick'))
}

const flexOf = (...els: HTMLElement[]): string[] => els.map((el) => el.style.flex)

describe.each([
  ['side-by-side', true],
  ['stacked', false]
] as const)('divider double-click on %s panes', (_label, isVertical) => {
  it('makes three panes thirds from the outer divider', () => {
    const callbacks = makeCallbacks()
    const [a, b, c] = [makePane(), makePane(), makePane()]
    // A | (B | C): each divider already separates equal-flex siblings (50/25/25).
    const inner = makeSplit(callbacks, isVertical, b, c)
    const outer = makeSplit(callbacks, isVertical, a, inner.split)

    doubleClick(outer.divider)

    expect(flexOf(a, inner.split, b, c)).toEqual(['1 1 0%', '2 1 0%', '1 1 0%', '1 1 0%'])
    expect(callbacks.refitPanesUnder).toHaveBeenCalledExactlyOnceWith(outer.split)
    expect(callbacks.onLayoutChanged).toHaveBeenCalledExactlyOnceWith('gesture')
  })

  it('makes three panes thirds from the inner divider', () => {
    const callbacks = makeCallbacks()
    const [a, b, c] = [makePane(), makePane(), makePane()]
    const inner = makeSplit(callbacks, isVertical, b, c)
    const outer = makeSplit(callbacks, isVertical, a, inner.split)

    doubleClick(inner.divider)

    expect(flexOf(a, inner.split, b, c)).toEqual(['1 1 0%', '2 1 0%', '1 1 0%', '1 1 0%'])
    expect(callbacks.refitPanesUnder).toHaveBeenCalledExactlyOnceWith(outer.split)
  })

  it('makes four dragged panes quarters', () => {
    const callbacks = makeCallbacks()
    const [a, b, c, d] = [
      makePane('120 1 0%'),
      makePane('40 1 0%'),
      makePane('7 1 0%'),
      makePane('3 1 0%')
    ]
    // A | (B | (C | D)) with every ratio dragged.
    const innermost = makeSplit(callbacks, isVertical, c, d, '90 1 0%')
    const inner = makeSplit(callbacks, isVertical, b, innermost.split, '300 1 0%')
    const outer = makeSplit(callbacks, isVertical, a, inner.split)

    doubleClick(inner.divider)

    expect(flexOf(a, inner.split, b, innermost.split, c, d)).toEqual([
      '1 1 0%',
      '3 1 0%',
      '1 1 0%',
      '2 1 0%',
      '1 1 0%',
      '1 1 0%'
    ])
    expect(callbacks.refitPanesUnder).toHaveBeenCalledExactlyOnceWith(outer.split)
  })

  it('leaves a cross-axis split inside the run alone', () => {
    const callbacks = makeCallbacks()
    const [a, b, c] = [makePane('3 1 0%'), makePane('5 1 0%'), makePane('2 1 0%')]
    // A | (B / C): the nested split runs along the other axis.
    const cross = makeSplit(callbacks, !isVertical, b, c, '1 1 0%')
    const outer = makeSplit(callbacks, isVertical, a, cross.split)

    doubleClick(outer.divider)

    // The cross-axis split is one slot, and its own children keep their dragged ratio.
    expect(flexOf(a, cross.split, b, c)).toEqual(['1 1 0%', '1 1 0%', '5 1 0%', '2 1 0%'])
    expect(callbacks.refitPanesUnder).toHaveBeenCalledExactlyOnceWith(outer.split)
  })

  it('leaves the enclosing cross-axis run alone', () => {
    const callbacks = makeCallbacks()
    const [a, b, c] = [makePane('3 1 0%'), makePane('5 1 0%'), makePane('2 1 0%')]
    const cross = makeSplit(callbacks, !isVertical, b, c, '4 1 0%')
    makeSplit(callbacks, isVertical, a, cross.split)

    doubleClick(cross.divider)

    expect(flexOf(a, cross.split, b, c)).toEqual(['3 1 0%', '4 1 0%', '1 1 0%', '1 1 0%'])
    expect(callbacks.refitPanesUnder).toHaveBeenCalledExactlyOnceWith(cross.split)
  })

  it('does nothing when the run is already equal', () => {
    const callbacks = makeCallbacks()
    const [a, b, c] = [makePane(), makePane(), makePane()]
    const inner = makeSplit(callbacks, isVertical, b, c, '2 1 0%')
    const outer = makeSplit(callbacks, isVertical, a, inner.split)

    doubleClick(outer.divider)
    doubleClick(inner.divider)

    expect(callbacks.refitPanesUnder).not.toHaveBeenCalled()
    expect(callbacks.onLayoutChanged).not.toHaveBeenCalled()
  })
})

it('ignores a double-click on a detached divider', () => {
  const callbacks = makeCallbacks()
  const divider = createDivider(true, {}, callbacks)

  doubleClick(divider)

  expect(callbacks.onLayoutChanged).not.toHaveBeenCalled()
})
