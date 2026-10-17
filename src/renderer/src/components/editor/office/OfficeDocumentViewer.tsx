import { type JSX, Suspense, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import type { OfficeDocumentKind } from '../../../../../shared/office-document-mime-types'
import { decodeOfficeDocumentBase64 } from './office-document-bytes'
import { officeZipWithinBudget } from './office-zip-budget'

// Why separate chunks: each renderer is large and most sessions never open an Office file.
const DocxDocumentView = lazy(() => import('./DocxDocumentView'))
const PptxDocumentView = lazy(() => import('./PptxDocumentView'))
const XlsxDocumentView = lazy(() => import('./XlsxDocumentView'))

export type OfficeDocumentViewProps = {
  bytes: Uint8Array<ArrayBuffer>
  filePath: string
  onError: (message: string) => void
}

type OfficeDocumentViewerProps = {
  content: string
  filePath: string
  kind: OfficeDocumentKind
}

export default function OfficeDocumentViewer(props: OfficeDocumentViewerProps): JSX.Element {
  // Why: a new file or new bytes must clear the previous render error.
  return <OfficeDocumentSurface key={`${props.filePath}\n${props.content}`} {...props} />
}

function OfficeDocumentSurface({
  content,
  filePath,
  kind
}: OfficeDocumentViewerProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const decoded = useMemo(() => {
    try {
      const bytes = decodeOfficeDocumentBase64(content)
      return officeZipWithinBudget(bytes) ? { bytes } : { failure: 'too-large' as const }
    } catch {
      return { failure: 'unreadable' as const }
    }
  }, [content])
  const bytes = 'bytes' in decoded ? decoded.bytes : null
  const filename = filePath.split(/[/\\]/).pop() || filePath
  const message =
    error ??
    ('failure' in decoded
      ? decoded.failure === 'too-large'
        ? translate(
            'auto.components.editor.office.OfficeDocumentViewer.tooLarge',
            'This file is not a valid Office document or expands too large to preview'
          )
        : translate(
            'auto.components.editor.office.OfficeDocumentViewer.decodeFailed',
            'Unable to read this file'
          )
      : null)
  const viewProps = bytes ? { bytes, filePath, onError: setError } : null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {viewProps && !error ? (
          <Suspense fallback={<OfficeDocumentLoading />}>
            {kind === 'docx' ? (
              <DocxDocumentView {...viewProps} />
            ) : kind === 'pptx' ? (
              <PptxDocumentView {...viewProps} />
            ) : (
              <XlsxDocumentView {...viewProps} />
            )}
          </Suspense>
        ) : null}
        {message ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-8 text-sm text-muted-foreground"
          >
            <FileText size={40} />
            <div>{message}</div>
            <div className="max-w-md break-all text-center text-xs">{filename}</div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" title={filename}>
          {filename}
        </span>
        <span>{officeDocumentPreviewLabel(kind)}</span>
      </div>
    </div>
  )
}

export function OfficeDocumentLoading(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {translate('auto.components.editor.office.OfficeDocumentViewer.loading', 'Loading preview…')}
    </div>
  )
}

function officeDocumentPreviewLabel(kind: OfficeDocumentKind): string {
  switch (kind) {
    case 'docx':
      return translate(
        'auto.components.editor.office.OfficeDocumentViewer.docxLabel',
        'Word preview'
      )
    case 'pptx':
      return translate(
        'auto.components.editor.office.OfficeDocumentViewer.pptxLabel',
        'PowerPoint preview'
      )
    case 'xlsx':
      return translate(
        'auto.components.editor.office.OfficeDocumentViewer.xlsxLabel',
        'Excel preview'
      )
  }
}

export function officeDocumentErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return translate(
    'auto.components.editor.office.OfficeDocumentViewer.renderFailed',
    'Unable to preview this file: {{value0}}',
    { value0: detail }
  )
}
