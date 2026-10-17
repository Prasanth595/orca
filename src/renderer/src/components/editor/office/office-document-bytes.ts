export function decodeOfficeDocumentBase64(content: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(content), (character) => character.charCodeAt(0))
}
