import { mobileMarkdownCodeLines } from '../components/mobile-markdown-tree'
import { formatNativeChatFileReference } from '../../../src/shared/agent-image-paste'
import { isAgentSessionAttachmentStorePath } from '../../../src/shared/agent-session-attachments'
import { isTextBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'

/** Desktop file attachments are serialized as @ references, without a separate wire block. */
export function splitMobileNativeChatFileAttachments(blocks: readonly NativeChatBlock[]): {
  files: string[]
  prose: NativeChatBlock[]
} {
  const files = new Set<string>()
  const prose = blocks.flatMap((block) => {
    if (!isTextBlock(block) || block.presentation || !block.text.includes('@')) {
      return [block]
    }
    const codeLines = mobileMarkdownCodeLines(block.text)
    const text = block.text
      .split('\n')
      .map((line, index) =>
        codeLines.has(index)
          ? line
          : line.replace(
              /(^|\s)(@"(?:\\"|[^"\r\n])*"|@'[^'\r\n]*'|@[^\s]+)(?=\s|$)/g,
              (match: string, space: string, token: string) => {
                const quoted = token[1] === '"' || token[1] === "'"
                const path = quoted ? token.slice(2, -1).replace(/\\"/g, '"') : token.slice(1)
                if (
                  !isAgentSessionAttachmentStorePath(path) ||
                  formatNativeChatFileReference(path) !== token
                ) {
                  return match
                }
                files.add(path)
                return space === '\n' || space === '\r' ? space : ''
              }
            )
      )
      .join('\n')
    return text === block.text ? [block] : text.trim().length > 0 ? [{ ...block, text }] : []
  })
  return { files: [...files], prose }
}
