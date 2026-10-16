import { clipboard, nativeImage, type NativeImage } from 'electron'
import { assertClipboardImageByteLengthWithinLimit } from '../../shared/clipboard-image'

export function readClipboardNativeImage(): NativeImage {
  const image = clipboard.readImage()
  if (!image.isEmpty() || process.platform !== 'darwin') {
    return image
  }
  // CleanShot can store JPEG bytes as public.png, which readImage decodes as PNG only.
  const buffer = clipboard.readBuffer('public.png')
  if (buffer.length === 0) {
    return image
  }
  assertClipboardImageByteLengthWithinLimit(buffer.length)
  return nativeImage.createFromBuffer(buffer)
}
