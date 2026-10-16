// Why one table: local IPC, runtime/SSH previews and the renderer's paged reads must agree, or a file previews on one route only.
export const OFFICE_DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx'

const OFFICE_DOCUMENT_KINDS: ReadonlyMap<string, OfficeDocumentKind> = new Map([
  [OFFICE_DOCUMENT_MIME_TYPES['.docx'], 'docx'],
  [OFFICE_DOCUMENT_MIME_TYPES['.xlsx'], 'xlsx'],
  [OFFICE_DOCUMENT_MIME_TYPES['.pptx'], 'pptx']
])

export function officeDocumentKind(mimeType: string | undefined): OfficeDocumentKind | null {
  return (mimeType && OFFICE_DOCUMENT_KINDS.get(mimeType)) || null
}
