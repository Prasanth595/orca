import { type JSX, useEffect, useRef } from 'react'
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import { routeOfficeDocumentLinkClick } from './office-document-links'
import { officeDocumentErrorMessage, type OfficeDocumentViewProps } from './OfficeDocumentViewer'

export default function PptxDocumentView({
  bytes,
  filePath,
  onError
}: OfficeDocumentViewProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scrollContainer = scrollRef.current
    const container = containerRef.current
    if (!scrollContainer || !container) {
      return
    }
    const abort = new AbortController()
    let viewer: PptxViewer | null = null
    // Why a host per run: destroy() empties its container, so a stale run must not own the live one's DOM.
    const host = document.createElement('div')
    container.append(host)
    const onClick = (event: MouseEvent): void =>
      routeOfficeDocumentLinkClick(event, container, filePath)
    container.addEventListener('click', onClick)
    // Why windowed + lazy: large decks would otherwise decode every slide and image up front.
    PptxViewer.open(bytes, host, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      fitMode: 'contain',
      scrollContainer,
      lazySlides: true,
      lazyMedia: true,
      pdfjs: false,
      listOptions: { windowed: true, showSlideLabels: true },
      signal: abort.signal
    }).then(
      (opened) => {
        if (abort.signal.aborted) {
          opened.destroy()
        } else {
          viewer = opened
        }
      },
      (error: unknown) => {
        if (!abort.signal.aborted) {
          onError(officeDocumentErrorMessage(error))
        }
      }
    )
    return () => {
      abort.abort()
      viewer?.destroy()
      container.removeEventListener('click', onClick)
      host.remove()
    }
  }, [bytes, filePath, onError])
  return (
    <div ref={scrollRef} className="scrollbar-editor absolute inset-0 overflow-auto bg-muted p-4">
      <div ref={containerRef} />
    </div>
  )
}
