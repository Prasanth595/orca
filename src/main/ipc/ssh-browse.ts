import { ipcMain } from 'electron'
import {
  browseSshDirectory,
  type RemoteBrowseResult,
  type SshBrowseConnection
} from '../ssh/ssh-remote-directory-browse'

type SshBrowseManager = {
  getConnection: (targetId: string) => SshBrowseConnection | undefined
}
export function registerSshBrowseHandler(
  getConnectionManager: () => SshBrowseManager | null
): void {
  ipcMain.removeHandler('ssh:browseDir')
  ipcMain.handle(
    'ssh:browseDir',
    (_event, args: { targetId: string; dirPath: string }): Promise<RemoteBrowseResult> =>
      browseSshDirectory(getConnectionManager(), args.targetId, args.dirPath)
  )
}
