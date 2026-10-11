import { getPtyIpc } from '../../pty-host-bindings'
import {
  commitTerminalViewAttributesSnapshot,
  getTerminalViewerHostColors,
  seedTerminalViewerColors,
  setTerminalViewerColorsListener
} from '../../../runtime/terminal-view-attribute-store'
import { seedAgentViewerColors } from '../../../runtime/terminal-view-attributes-seed'
import { validateTerminalViewAttributesPush } from '../../../../shared/terminal-view-attributes'
import { resolveConfiguredTerminalColors } from '../../../../shared/terminal-theme-selection'
import { publishColorQueryReplyColors } from '../provider/registry'
import type { PtyIpcSession } from '../session'

export function installTerminalViewAttributesIpc(
  session: Pick<PtyIpcSession, 'getSettings' | 'options'>
): void {
  setTerminalViewerColorsListener(publishColorQueryReplyColors)
  const settings = session.getSettings?.()
  // Why seed from settings: a headless host may never hear from a viewer, and a desktop pane
  // can query before the first push lands; either way the owner should answer with the saved theme.
  if (settings) {
    const systemPrefersDark = session.options?.systemPrefersDark?.() ?? true
    seedTerminalViewerColors(
      resolveConfiguredTerminalColors(settings, systemPrefersDark),
      seedAgentViewerColors(settings, systemPrefersDark)
    )
  }
  const current = getTerminalViewerHostColors()
  if (current) {
    publishColorQueryReplyColors(current)
  }
  const ipcMain = getPtyIpc()
  ipcMain.removeAllListeners('pty:terminalViewAttributes')
  ipcMain.on('pty:terminalViewAttributes', (_event, args: unknown) => {
    // Why validate-or-drop: a malformed palette would give TUIs a wrong color reply.
    const push = validateTerminalViewAttributesPush(args)
    if (push) {
      commitTerminalViewAttributesSnapshot(push)
    }
  })
}
