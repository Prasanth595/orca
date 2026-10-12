/** Local snapshot; keep it until the destination import settles, then release its handle. */
export type ClipboardImageImport = {
  handle: string
  path: string
}
