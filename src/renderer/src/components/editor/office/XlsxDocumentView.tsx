import { type JSX, useEffect, useState } from 'react'
import readExcelFile from 'read-excel-file/browser'
import { translate } from '@/i18n/i18n'
import { CsvGrid } from '../csv/CsvGrid'
import { buildXlsxSheetGrid, type XlsxSheetGrid } from './xlsx-sheet-grid'
import {
  OfficeDocumentLoading,
  officeDocumentErrorMessage,
  type OfficeDocumentViewProps
} from './OfficeDocumentViewer'

export default function XlsxDocumentView({ bytes, onError }: OfficeDocumentViewProps): JSX.Element {
  const [sheets, setSheets] = useState<XlsxSheetGrid[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => {
    let cancelled = false
    readExcelFile(bytes.buffer).then(
      (workbook) => {
        if (!cancelled) {
          setSheets(workbook.map(({ sheet, data }) => buildXlsxSheetGrid(sheet, data)))
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          onError(officeDocumentErrorMessage(error))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [bytes, onError])
  if (!sheets) {
    return <OfficeDocumentLoading />
  }
  const sheet = sheets[Math.min(activeIndex, sheets.length - 1)]
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col">
      {sheet && sheet.columnCount > 0 ? (
        <XlsxSheetTable key={sheet.name} sheet={sheet} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {translate('auto.components.editor.office.XlsxDocumentView.emptySheet', 'Empty sheet')}
        </div>
      )}
      {sheets.length > 1 ? (
        <div role="tablist" className="flex gap-1 overflow-x-auto border-t px-2 py-1 text-xs">
          {sheets.map((entry, index) => (
            <button
              key={entry.name /* Excel keeps sheet names unique per workbook. */}
              type="button"
              role="tab"
              aria-selected={entry === sheet}
              className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
              onClick={() => setActiveIndex(index)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function XlsxSheetTable({ sheet }: { sheet: XlsxSheetGrid }): JSX.Element {
  return (
    <CsvGrid
      header={sheet.header}
      rowCount={sheet.rows.length}
      columnCount={sheet.columnCount}
      sampleRows={sheet.rows.slice(0, 200)}
      getRow={(index) => sheet.rows[index]}
    />
  )
}
