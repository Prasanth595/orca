import { describe, expect, it } from 'vitest'
import { OFFICE_ZIP_MAX_UNCOMPRESSED_BYTES, officeZipWithinBudget } from './office-zip-budget'

/** A zip with only a central directory: enough for the size scan, which never reads entry data. */
function centralDirectoryZip(sizes: number[]): Uint8Array {
  const name = new TextEncoder().encode('a')
  const entries = sizes.map((size) => {
    const entry = new DataView(new ArrayBuffer(46 + name.length))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint32(24, size, true)
    entry.setUint16(28, name.length, true)
    new Uint8Array(entry.buffer).set(name, 46)
    return new Uint8Array(entry.buffer)
  })
  const directoryBytes = entries.reduce((sum, entry) => sum + entry.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(10, sizes.length, true)
  end.setUint32(12, directoryBytes, true)
  end.setUint32(16, 0, true)
  const zip = new Uint8Array(directoryBytes + 22)
  let offset = 0
  for (const entry of entries) {
    zip.set(entry, offset)
    offset += entry.length
  }
  zip.set(new Uint8Array(end.buffer), offset)
  return zip
}

describe('officeZipWithinBudget', () => {
  it('accepts a zip whose declared sizes fit the budget', () => {
    expect(officeZipWithinBudget(centralDirectoryZip([1024, 2048]))).toBe(true)
  })

  it('refuses a zip that declares more than the budget in total', () => {
    const half = OFFICE_ZIP_MAX_UNCOMPRESSED_BYTES / 2
    expect(officeZipWithinBudget(centralDirectoryZip([half, half, 1]))).toBe(false)
  })

  it('refuses bytes that are not a zip', () => {
    expect(officeZipWithinBudget(new TextEncoder().encode('not a zip at all, just text'))).toBe(
      false
    )
  })
})
