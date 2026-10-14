// scrcpy server v2.4 deployment command builders (pure). The impure orchestration
// (push the jar, open the tunnel, spawn the server, connect sockets) lives in
// scrcpy-stream-session. The option names/order are version-coupled to scrcpy and
// pinned to SCRCPY_SERVER_VERSION (validated live against that jar on a device).

export const SCRCPY_SERVER_VERSION = '2.4'
export const SCRCPY_DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server.jar'
const SCRCPY_FORWARD_REMOTE_PREFIX = 'localabstract:scrcpy_'

// `adb -s <serial> push <localJar> <deviceJar>`
export function pushScrcpyServerArgs(
  serial: string,
  localJarPath: string,
  deviceJarPath: string = SCRCPY_DEVICE_JAR_PATH
): string[] {
  return ['-s', serial, 'push', localJarPath, deviceJarPath]
}

// `adb -s <serial> forward tcp:<port> localabstract:scrcpy_<scid>` — with
// tunnel_forward the server listens on the abstract socket and adb forwards a
// local TCP port to it.
export function scrcpyForwardArgs(serial: string, localPort: number, scid: string): string[] {
  return ['-s', serial, 'forward', `tcp:${localPort}`, `${SCRCPY_FORWARD_REMOTE_PREFIX}${scid}`]
}

export function scrcpyRemoveForwardArgs(serial: string, localPort: number): string[] {
  return ['-s', serial, 'forward', '--remove', `tcp:${localPort}`]
}

// `-s` does not filter `forward --list`: adb prints every device's forwards, one
// `<serial> <local> <remote>` line each.
export function listForwardsArgs(serial: string): string[] {
  return ['-s', serial, 'forward', '--list']
}

// Local TCP ports of `serial`'s scrcpy tunnels in `adb forward --list` output.
export function parseScrcpyForwardPorts(listOutput: string, serial: string): number[] {
  const ports: number[] = []
  for (const line of listOutput.split('\n')) {
    const [lineSerial, local, remote, ...rest] = line.trim().split(/\s+/)
    if (
      rest.length > 0 ||
      lineSerial !== serial ||
      !remote?.startsWith(SCRCPY_FORWARD_REMOTE_PREFIX)
    ) {
      continue
    }
    const port = /^tcp:(\d+)$/.exec(local ?? '')?.[1]
    if (port) {
      ports.push(Number(port))
    }
  }
  return ports
}

export type ScrcpyServerOptions = {
  scid: string
  maxSize?: number
  maxFps?: number
  videoBitRate?: number
  deviceJarPath?: string
  version?: string
}

// `adb -s <serial> shell CLASSPATH=<jar> app_process / com.genymobile.scrcpy.Server <version> <key=value...>`
export function startScrcpyServerArgs(serial: string, options: ScrcpyServerOptions): string[] {
  const version = options.version ?? SCRCPY_SERVER_VERSION
  const jar = options.deviceJarPath ?? SCRCPY_DEVICE_JAR_PATH
  const params = [
    `scid=${options.scid}`,
    'log_level=info',
    'tunnel_forward=true',
    'audio=false',
    'control=true',
    'cleanup=true',
    'clipboard_autosync=false',
    'video_codec=h264'
  ]
  if (options.maxSize !== undefined) {
    params.push(`max_size=${options.maxSize}`)
  }
  if (options.maxFps !== undefined) {
    params.push(`max_fps=${options.maxFps}`)
  }
  if (options.videoBitRate !== undefined) {
    params.push(`video_bit_rate=${options.videoBitRate}`)
  }
  return [
    '-s',
    serial,
    'shell',
    `CLASSPATH=${jar}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    version,
    ...params
  ]
}
