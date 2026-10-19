import type { TerminalInputOrigin } from '../../shared/terminal-input-kind'

/** Retains protocol state and the last submit's author, never the input text. */
export class TerminalSubmitKeys {
  private paste = false
  private escape = ''
  private author: TerminalInputOrigin | undefined

  interruptPaste(): void {
    this.paste = false
    this.escape = ''
  }

  record(data: string, author: TerminalInputOrigin): void {
    if (data === '\x1b') {
      this.escape = ''
      return
    }
    for (const character of data) {
      if (this.escape) {
        if (this.escape.length < 16) {
          this.escape += character
        } else {
          this.escape = '\x1b[?'
        }
        if (this.escape === '\x1b[') {
          continue
        }
        if (this.escape.startsWith('\x1b[') && !/[@-~]/.test(character)) {
          continue
        }
        const sequence = this.escape
        this.escape = ''
        if (sequence === '\x1b[200~') {
          this.paste = true
        } else if (sequence === '\x1b[201~') {
          this.paste = false
        } else if (!this.paste && /^\[13(?:;1(?::[12])?)?u$/.test(sequence.slice(1))) {
          this.author = author
        }
        continue
      }
      if (character === '\x1b') {
        this.escape = character
      } else if (!this.paste && character === '\r') {
        this.author = author
      }
    }
  }

  take(): TerminalInputOrigin | undefined {
    const author = this.author
    this.author = undefined
    return author
  }
}
