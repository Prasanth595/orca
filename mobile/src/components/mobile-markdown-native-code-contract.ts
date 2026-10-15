import type { MarkdownCodeRange } from './mobile-markdown-inline-code-ranges'
export type NativeMarkdownCode = {
  decorateText: (
    tag: number,
    expectedText: string,
    ranges: MarkdownCodeRange[],
    background: string,
    radius: number,
    horizontalPadding: number,
    verticalPadding: number
  ) => Promise<{ applied: boolean; height: number }>
}
