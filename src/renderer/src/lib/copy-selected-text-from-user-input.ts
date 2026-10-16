type SelectedTextCopyOptions = {
  text: string
  writeClipboardText: (text: string) => Promise<void>
  allowNativeCopy?: boolean
  beforeNativeCopy?: () => void
}

export async function copySelectedTextFromUserInput({
  text,
  writeClipboardText,
  allowNativeCopy = true,
  beforeNativeCopy
}: SelectedTextCopyOptions): Promise<void> {
  if (!text) {
    return
  }
  const platform = window.api.platform?.get?.()
  if (allowNativeCopy && platform?.platform === 'linux' && platform.displayServer === 'wayland') {
    // Keep the input serial and clipboard source on the focused Wayland connection.
    beforeNativeCopy?.()
    window.api.ui.performNativeSelectionAction('copy')
    return
  }
  await writeClipboardText(text)
}
