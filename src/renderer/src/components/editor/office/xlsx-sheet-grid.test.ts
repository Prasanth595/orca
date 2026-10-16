import { describe, expect, it } from 'vitest'
import { buildXlsxSheetGrid, xlsxCellText } from './xlsx-sheet-grid'

describe('buildXlsxSheetGrid', () => {
  it('splits the header row and pads ragged rows to the widest row', () => {
    const grid = buildXlsxSheetGrid('Sheet1', [['Name', 'Age'], ['Kate', 15, true], [null]])
    expect(grid).toEqual({
      name: 'Sheet1',
      header: ['Name', 'Age', ''],
      rows: [
        ['Kate', '15', 'TRUE'],
        ['', '', '']
      ],
      columnCount: 3
    })
  })

  it('returns an empty grid for an empty sheet', () => {
    expect(buildXlsxSheetGrid('Empty', [])).toEqual({
      name: 'Empty',
      header: [],
      rows: [],
      columnCount: 0
    })
  })
})

describe('xlsxCellText', () => {
  it('shows date-only cells without a midnight time', () => {
    expect(xlsxCellText(new Date(Date.UTC(2026, 9, 16)))).toBe('2026-10-16')
  })

  it('keeps the time for date-time cells', () => {
    expect(xlsxCellText(new Date(Date.UTC(2026, 9, 16, 9, 30)))).toBe('2026-10-16T09:30:00.000Z')
  })
})
