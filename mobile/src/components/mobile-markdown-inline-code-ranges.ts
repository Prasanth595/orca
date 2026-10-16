import { Children, isValidElement, type ReactNode } from 'react'
import type { TextProps } from 'react-native'

export type MarkdownTextProps = TextProps & { inlineCode?: boolean }
export type MarkdownCodeRange = { start: number; end: number }

/** UTF-16 offsets match Android spans; the original characters are never padded or replaced. */
export function collectMarkdownCodeRanges(children: ReactNode) {
  let text = ''
  const ranges: MarkdownCodeRange[] = []
  function visit(nodes: ReactNode, insideCode = false): void {
    Children.forEach(nodes, (child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        text += child
      } else if (isValidElement<{ children?: ReactNode; inlineCode?: boolean }>(child)) {
        const start = text.length
        const code = child.props.inlineCode === true && !insideCode
        visit(child.props.children, insideCode || code)
        if (code && text.length > start) {
          ranges.push({ start, end: text.length })
        }
      }
    })
  }
  visit(children)
  return { text, ranges }
}
