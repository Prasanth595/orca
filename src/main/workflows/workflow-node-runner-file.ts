import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileReadData, FileWriteData } from '../../shared/workflow-types'
import type { RemoteExecFn } from './workflow-remote-exec'

export type FileReadResult = { content: string }
export type FileWriteResult = { bytesWritten: number }

/** Shell-quote a path so it is safe to embed in a remote command string. */
function shellQuotePath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

export async function runFileReadNode(
  data: FileReadData,
  remoteExec?: RemoteExecFn
): Promise<FileReadResult> {
  if (remoteExec) {
    const result = await remoteExec(`cat ${shellQuotePath(data.filePath)}`)
    return { content: result.stdout }
  }
  const content = await readFile(data.filePath, 'utf8')
  return { content }
}

export async function runFileWriteNode(
  data: FileWriteData,
  resolvedContent: string,
  remoteExec?: RemoteExecFn
): Promise<FileWriteResult> {
  if (remoteExec) {
    const qPath = shellQuotePath(data.filePath)
    const mkdirPrefix = data.createParents
      ? `mkdir -p ${shellQuotePath(dirname(data.filePath))} && `
      : ''
    const redirect = data.mode === 'append' ? '>>' : '>'
    await remoteExec(`${mkdirPrefix}cat ${redirect} ${qPath}`, { stdin: resolvedContent })
    return { bytesWritten: Buffer.byteLength(resolvedContent, 'utf8') }
  }
  if (data.createParents) {
    await mkdir(dirname(data.filePath), { recursive: true })
  }
  await writeFile(
    data.filePath,
    resolvedContent,
    data.mode === 'append' ? { flag: 'a', encoding: 'utf8' } : { encoding: 'utf8' }
  )
  return { bytesWritten: Buffer.byteLength(resolvedContent, 'utf8') }
}
