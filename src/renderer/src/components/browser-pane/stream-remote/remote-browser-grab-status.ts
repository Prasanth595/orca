import { translate } from '@/i18n/i18n'
import { RemoteGrabProtocolError } from '../../../../../shared/browser-grab/remote-grab-point-script'
import { RemoteGrabNavigatedError } from './remote-browser-grab-session-types'

export type RemoteBrowserGrabStatus =
  | 'starting'
  | 'ready'
  | 'selecting'
  | 'empty'
  | 'moved'
  | 'selected'

export function remoteBrowserGrabStatusMessage(status: RemoteBrowserGrabStatus): string {
  switch (status) {
    case 'starting':
      return translate('browser.remote.grab.starting', 'Starting element selection…')
    case 'selecting':
      return translate('browser.remote.grab.selecting', 'Reading the selected element…')
    case 'empty':
      return translate('browser.remote.grab.empty', 'Nothing to select there. Pick an element.')
    case 'moved':
      return translate(
        'browser.remote.grab.moved',
        'The page moved before the click arrived. Click again.'
      )
    case 'ready':
    case 'selected':
      return translate(
        'browser.remote.grab.instructions',
        'Click an element to select it. Right-click for more actions. Esc to cancel.'
      )
  }
}

/** Transport errors keep the runtime's own text, as the pane's other remote failures do. */
export function remoteBrowserGrabFailureText(error: unknown): string {
  if (error instanceof RemoteGrabNavigatedError) {
    return translate(
      'browser.remote.grab.pageChanged',
      'The page changed. Start element selection again.'
    )
  }
  if (error instanceof Error && error.message && !(error instanceof RemoteGrabProtocolError)) {
    return error.message
  }
  return translate('browser.remote.grab.failed', 'Could not select the remote element.')
}
