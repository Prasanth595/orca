import { translate } from '@/i18n/i18n'

export type GlassCopyPlatform = 'mac' | 'windows' | 'linux'

export function getGlassCopyPlatform(
  platform: string | undefined = window.api?.platform?.get().platform
): GlassCopyPlatform {
  if (platform === 'darwin') {
    return 'mac'
  }
  return platform === 'win32' ? 'windows' : 'linux'
}

const KEY = 'auto.components.settings.TerminalWindowSection.glass'

export function windowBlurDescription(platform: GlassCopyPlatform): string {
  if (platform === 'mac') {
    return translate(
      `${KEY}.blurMac`,
      'Frosted-glass desktop behind terminals and the chat UI. Tune it with Background Opacity and Chat Glass Opacity. Uses some extra GPU power. Requires restart.'
    )
  }
  if (platform === 'windows') {
    return translate(
      `${KEY}.blurWindows`,
      "Requests the Windows 11 acrylic backdrop. Orca's panels stay opaque on Windows, so terminals and chat don't show it yet. Requires restart."
    )
  }
  return translate(`${KEY}.blurLinux`, 'Not available on Linux.')
}

export function backgroundOpacityDescription(platform: GlassCopyPlatform): string {
  if (platform === 'mac') {
    return translate(
      `${KEY}.opacityMac`,
      "Terminal background opacity, 1 is solid. With Window Blur on, lower values show the blurred desktop; with it off, they only blend into Orca's own background."
    )
  }
  return translate(
    `${KEY}.opacityOther`,
    "Terminal background opacity, 1 is solid. Orca's window is opaque on this platform, so lower values blend into Orca's own background instead of showing the desktop."
  )
}

export function chatGlassOpacityDescription(blurEnabled: boolean): string {
  return blurEnabled
    ? translate(
        `${KEY}.chatOpacity`,
        'Chat UI background opacity over the blurred desktop, 1 is solid. Lower values show more of the desktop.'
      )
    : translate(`${KEY}.chatOpacityNeedsBlur`, 'Turn on Window Blur (and restart) to use this.')
}
