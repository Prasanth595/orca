/** Device-pixel size of one terminal cell. */
export type TerminalCellPixelSize = { width: number; height: number }

/** Rounds valid device-cell metrics for the integer-only `CSI 16 t` reply. */
export function roundTerminalCellPixelSize(cell: {
  width: number
  height: number
}): TerminalCellPixelSize | null {
  if (
    !Number.isFinite(cell.width) ||
    !Number.isFinite(cell.height) ||
    cell.width <= 0 ||
    cell.height <= 0
  ) {
    return null
  }
  return {
    width: Math.max(1, Math.round(cell.width)),
    height: Math.max(1, Math.round(cell.height))
  }
}

/** XTWINOPS replies use device cell (16t) or text-area canvas (14t) pixels. */
export function formatTerminalPixelSizeReply(
  query: 14 | 16,
  cell: TerminalCellPixelSize,
  canvas?: { width: number; height: number }
): string | null {
  if (query === 16) {
    return `\x1b[6;${cell.height};${cell.width}t`
  }
  if (!canvas) {
    return null
  }
  // The image backing store floors the device canvas, so a full-width image sized from 14t fits exactly.
  const width = Math.floor(canvas.width)
  const height = Math.floor(canvas.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null
  }
  return `\x1b[4;${height};${width}t`
}
