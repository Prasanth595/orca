import type { CellValue, Row } from 'read-excel-file/browser'

export type XlsxSheetGrid = {
  name: string
  header: string[]
  rows: string[][]
  columnCount: number
}

// Why `| Date`: the package types dates as `typeof Date`, but it returns Date instances.
export function xlsxCellText(value: CellValue | Date | null): string {
  if (value === null) {
    return ''
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().replace(/T00:00:00\.000Z$/, '')
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  return String(value)
}

/** Pads every row to the widest row, since the grid draws a fixed column count. */
export function buildXlsxSheetGrid(name: string, data: readonly Row[]): XlsxSheetGrid {
  const columnCount = data.reduce((max, row) => Math.max(max, row.length), 0)
  const cells = data.map((row) =>
    Array.from({ length: columnCount }, (_, column) => xlsxCellText(row[column] ?? null))
  )
  return { name, header: cells[0] ?? [], rows: cells.slice(1), columnCount }
}
