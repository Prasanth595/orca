import { Fragment, createElement } from 'react'
import { expect, it } from 'vitest'
import { collectMarkdownCodeRanges } from './mobile-markdown-inline-code-ranges'

it('retains original characters and uses UTF-16 offsets across formatting, emoji and code links', () => {
  const tree = createElement(
    Fragment,
    null,
    '🙂 Use ',
    createElement('span', { inlineCode: true, onPress() {} }, 'src/a.ts:3'),
    ' and ',
    createElement('span', null, 'plain ', createElement('span', { inlineCode: true }, 'npm test')),
    '.'
  )
  const result = collectMarkdownCodeRanges(tree)
  expect(result.text).toBe('🙂 Use src/a.ts:3 and plain npm test.')
  expect(result.ranges.map((range) => result.text.slice(range.start, range.end))).toEqual([
    'src/a.ts:3',
    'npm test'
  ])
  expect(result.ranges[0].start).toBe(7)
})
it('does not duplicate nested code annotations or decorate plain source code blocks', () => {
  expect(
    collectMarkdownCodeRanges(
      createElement(
        'span',
        { inlineCode: true },
        'outer ',
        createElement('span', { inlineCode: true }, 'inner')
      )
    ).ranges
  ).toEqual([{ start: 0, end: 11 }])
  expect(collectMarkdownCodeRanges('a < b && c').ranges).toEqual([])
})
