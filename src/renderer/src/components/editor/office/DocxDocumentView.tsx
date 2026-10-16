import { type JSX, useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'
import { routeOfficeDocumentLinkClick } from './office-document-links'
import { officeDocumentErrorMessage, type OfficeDocumentViewProps } from './OfficeDocumentViewer'

export default function DocxDocumentView({
  bytes,
  filePath,
  onError
}: OfficeDocumentViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let cancelled = false
    const onClick = (event: MouseEvent): void =>
      routeOfficeDocumentLinkClick(event, container, filePath)
    container.addEventListener('click', onClick)
    // Why renderAltChunks off: alt chunks embed author HTML in an iframe inside Orca's renderer.
    renderAsync(bytes, container, undefined, {
      renderAltChunks: false,
      useBase64URL: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true
    }).catch((error: unknown) => {
      if (!cancelled) {
        onError(officeDocumentErrorMessage(error))
      }
    })
    return () => {
      cancelled = true
      container.removeEventListener('click', onClick)
      container.replaceChildren()
    }
  }, [bytes, filePath, onError])
  // Why light background in both themes: Word pages carry their own (usually white) page colour.
  return (
    <div ref={containerRef} className="scrollbar-editor absolute inset-0 overflow-auto bg-muted" />
  )
}
