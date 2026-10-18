/** Device-pixel size of one terminal cell. */
export type TerminalCellPixelSize = { width: number; height: number }

/** Rounds xterm's (possibly fractional) device cell so 14t and 16t replies stay consistent. */
export function roundTerminalCellPixelSize(cell: {
  width: number
  height: number
}): TerminalCellPixelSize | null {
  if (!(cell.width > 0) || !(cell.height > 0)) {
    return null
  }
  return {
    width: Math.max(1, Math.round(cell.width)),
    height: Math.max(1, Math.round(cell.height))
  }
}

/** XTWINOPS reply: `CSI 16 t` → cell size, `CSI 14 t` → text area as cell × grid. */
export function formatTerminalPixelSizeReply(
  query: 14 | 16,
  cell: TerminalCellPixelSize,
  cols: number,
  rows: number
): string {
  return query === 14
    ? `\x1b[4;${cell.height * rows};${cell.width * cols}t`
    : `\x1b[6;${cell.height};${cell.width}t`
}
