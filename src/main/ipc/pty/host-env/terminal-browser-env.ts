import { getWslCliCommandName } from '../../../cli/wsl-managed-cli'

export function applyTerminalBrowserEnv(
  env: NodeJS.ProcessEnv,
  opts: {
    isWsl: boolean
    isPackaged: boolean
    routeBrowserOpensToClient: boolean
    forceOrcaBrowserOpens: boolean
  }
): void {
  const cli = opts.isWsl ? getWslCliCommandName(opts.isPackaged) : 'orca'
  if (opts.forceOrcaBrowserOpens) {
    // Why: desktop `open-url` needs a client host lease and a worktree; `tab create` does not.
    env.BROWSER = opts.routeBrowserOpensToClient
      ? `${cli} open-url --url %s`
      : `${cli} tab create --activate --url %s`
    return
  }
  if (
    opts.routeBrowserOpensToClient &&
    env.BROWSER === undefined &&
    process.env.BROWSER === undefined
  ) {
    env.BROWSER = `${cli} open-url --url %s`
  }
}
