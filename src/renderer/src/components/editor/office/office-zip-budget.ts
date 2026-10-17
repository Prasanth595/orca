// Why: docx-preview and read-excel-file inflate every entry with no limit, so a tiny zip bomb could exhaust the renderer.
// Same total as pptx-renderer's RECOMMENDED_ZIP_LIMITS.
export const OFFICE_ZIP_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const OFFICE_ZIP_MAX_ENTRIES = 4000

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const END_RECORD_BYTES = 22
const MAX_COMMENT_BYTES = 0xffff

/** Sums the sizes the zip's central directory declares, without inflating anything. */
export function officeZipWithinBudget(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEndOfCentralDirectory(view)
  if (end === null) {
    return false
  }
  const entryCount = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  if (entryCount > OFFICE_ZIP_MAX_ENTRIES) {
    return false
  }
  let total = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      return false
    }
    // Why: 0xffffffff means a zip64 size, which no Office preview needs.
    total += view.getUint32(offset + 24, true)
    if (total > OFFICE_ZIP_MAX_UNCOMPRESSED_BYTES) {
      return false
    }
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
  }
  return true
}

function findEndOfCentralDirectory(view: DataView): number | null {
  const lowest = Math.max(0, view.byteLength - END_RECORD_BYTES - MAX_COMMENT_BYTES)
  for (let offset = view.byteLength - END_RECORD_BYTES; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      return offset
    }
  }
  return null
}
