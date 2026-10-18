import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackedBitmap, write, writeKitty } from './xterm-kitty-placeholder-test-terminal.mjs'

const require = createRequire(import.meta.url)
const { Terminal } = require('@xterm/xterm')
const { ImageAddon } = require('@xterm/addon-image')

function terminalDimensions(dpr, width = 8, height = 16) {
  return {
    css: {
      cell: { width, height },
      canvas: { width: width * 20, height: height * 6 }
    },
    device: {
      cell: { width: width * dpr, height: height * dpr },
      canvas: { width: width * dpr * 20, height: height * dpr * 6 }
    }
  }
}

function createTerminal(dpr = 2, enableSizeReports = false) {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 6 })
  const dimensions = vi
    .spyOn(terminal, 'dimensions', 'get')
    .mockReturnValue(terminalDimensions(dpr))
  const addon = new ImageAddon({
    enableSizeReports,
    storageLimit: 32,
    kittySizeLimit: 8 * 1024 * 1024
  })
  terminal.loadAddon(addon)
  const replies = []
  terminal.onData((data) => replies.push(data))
  const document = {
    createElement: vi.fn(() => {
      const canvas = { style: {}, classList: { add() {} }, remove() {} }
      const context = {
        canvas,
        drawImage: vi.fn(),
        clearRect: vi.fn(),
        putImageData: vi.fn(),
        dimensionClears: vi.fn()
      }
      for (const dimension of ['width', 'height']) {
        let value = 0
        Object.defineProperty(canvas, dimension, {
          get: () => value,
          set: (size) => {
            value = Math.trunc(size)
            context.dimensionClears(dimension, value)
          }
        })
      }
      canvas.getContext = () => context
      return canvas
    })
  }
  const decode = vi.fn(async (source, options) => {
    return new TrackedBitmap(
      options?.resizeWidth ?? source.width,
      options?.resizeHeight ?? source.height
    )
  })
  vi.stubGlobal('ImageBitmap', TrackedBitmap)
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(data, width, height) {
        this.data = typeof data === 'number' ? new Uint8ClampedArray(data * width * 4) : data
        this.width = typeof data === 'number' ? data : width
        this.height = typeof data === 'number' ? width : height
      }
    }
  )
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('window', { document, ImageBitmap: TrackedBitmap, createImageBitmap: decode })
  const renderer = addon._renderer
  vi.spyOn(renderer, 'document', 'get').mockReturnValue(document)
  terminal._core.screenElement = {
    style: {},
    appendChild() {},
    insertBefore() {},
    firstChild: null
  }
  return { terminal, addon, renderer, dimensions, decode, replies }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('installed xterm image device-pixel contract', () => {
  it('keeps device-resolution layer canvases aligned to CSS size across DPR changes', () => {
    const h = createTerminal()
    try {
      expect(h.renderer.cellSize).toEqual({ width: 16, height: 32 })
      for (const layer of ['top', 'bottom']) {
        h.renderer.insertLayerToDom(layer)
        const context = h.renderer._layers.get(layer)
        expect([context.canvas.width, context.canvas.height]).toEqual([320, 192])
        expect(context.canvas.style).toMatchObject({ width: '160px', height: '96px' })
        expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 320, 192)
      }
      h.renderer.clearLines(1, 2)
      for (const context of h.renderer._layers.values()) {
        expect(context.clearRect).toHaveBeenLastCalledWith(0, 32, 320, 64)
      }

      h.dimensions.mockReturnValue(terminalDimensions(1, 10, 20))
      h.renderer.rescaleCanvas()
      expect(h.renderer.cellSize).toEqual({ width: 10, height: 20 })
      for (const context of h.renderer._layers.values()) {
        expect([context.canvas.width, context.canvas.height]).toEqual([200, 120])
        expect(context.canvas.style).toMatchObject({ width: '200px', height: '120px' })
      }

      h.dimensions.mockReturnValue(terminalDimensions(2, 5, 10))
      h.renderer.rescaleCanvas()
      for (const context of h.renderer._layers.values()) {
        expect([context.canvas.width, context.canvas.height]).toEqual([200, 120])
        expect(context.canvas.style).toMatchObject({ width: '100px', height: '60px' })
      }
    } finally {
      h.terminal.dispose()
    }
  })

  it('preserves stored image rows when fractional device dimensions receive a partial repaint', async () => {
    const h = createTerminal()
    try {
      const dimensions = terminalDimensions(2, 21.2625)
      dimensions.css.canvas.width = 425
      h.dimensions.mockReturnValue(dimensions)
      const pixels = Buffer.alloc(160 * 96 * 4, 255).toString('base64')
      await writeKitty(h.terminal, 'a=T,f=32,s=160,v=96,i=7,c=10,r=3,C=1', pixels)
      expect(h.addon.getImageAtBufferCell(0, 0)).toBeDefined()
      h.addon._storage.render({ start: 0, end: 5 })
      const context = h.renderer._layers.get('top')
      expect([context.canvas.width, context.canvas.height]).toEqual([850, 192])
      expect(context.canvas.style).toMatchObject({ width: '425px', height: '96px' })
      context.dimensionClears.mockClear()
      context.clearRect.mockClear()
      context.drawImage.mockClear()

      h.addon._storage.render({ start: 4, end: 4 })
      expect(context.dimensionClears).not.toHaveBeenCalled()
      expect(context.clearRect.mock.calls).toEqual([[0, 128, 850.5, 32]])
      expect(context.drawImage).not.toHaveBeenCalled()
    } finally {
      h.terminal.dispose()
    }
  })

  it('grows evicted-image placeholder strips to the full device canvas at DPR 2', async () => {
    const h = createTerminal()
    vi.stubGlobal('screen', { width: 160 })
    try {
      const storage = h.addon._storage
      const options = { scrolling: true, layer: 'top', zIndex: 0 }
      await write(h.terminal, '\x1b[1;13H')
      storage.addImage(new TrackedBitmap(8192, 32), options)
      await write(h.terminal, '\x1b[6;1H')
      storage.addImage(new TrackedBitmap(16, 32), options)
      h.addon.storageLimit = 0.5
      expect(h.addon.getImageAtBufferCell(12, 0)).toBeUndefined()
      storage.render({ start: 0, end: 0 })
      const context = h.renderer._layers.get('top')
      expect(context.drawImage.mock.calls.at(-1)[0].width).toBeGreaterThanOrEqual(320)

      h.dimensions.mockReturnValue(terminalDimensions(2, 16))
      storage.render({ start: 0, end: 0 })
      const [source, sx, , sourceWidth, , dx, , drawWidth] = context.drawImage.mock.calls.at(-1)
      expect([sx, sourceWidth, dx, drawWidth]).toEqual([384, 256, 384, 256])
      expect(Math.min(sourceWidth, Math.max(0, source.width - sx))).toBe(drawWidth)
      const createElement = h.renderer.document.createElement
      const allocations = createElement.mock.calls.length
      storage.render({ start: 0, end: 0 })
      expect(createElement).toHaveBeenCalledTimes(allocations)
    } finally {
      h.terminal.dispose()
    }
  })

  it.each([2, 1])(
    'places a c/r-sized Kitty bitmap at full device resolution at DPR %i',
    async (dpr) => {
      const h = createTerminal(dpr)
      try {
        const pixels = Buffer.alloc(160 * 96 * 4, 255).toString('base64')
        await writeKitty(h.terminal, 'a=T,f=32,s=160,v=96,i=7,c=10,r=3,C=1', pixels)
        expect(h.replies.map((reply) => reply.slice(3, -2))).toEqual(['i=7;OK'])
        const width = 80 * dpr
        const height = 48 * dpr
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 10; col++) {
            expect(h.addon.getImageAtBufferCell(col, row)).toMatchObject({ width, height })
          }
        }
        expect(h.addon.getImageAtBufferCell(10, 0)).toBeUndefined()
        expect(h.addon.getImageAtBufferCell(0, 3)).toBeUndefined()

        h.addon._storage.render({ start: 0, end: 5 })
        const context = h.renderer._layers.get('top')
        expect(context.drawImage).toHaveBeenCalledTimes(3)
        expect(context.drawImage.mock.calls[0].slice(1)).toEqual([
          0,
          0,
          width,
          16 * dpr,
          0,
          0,
          width,
          16 * dpr
        ])
        expect([context.canvas.width, context.canvas.height]).toEqual([160 * dpr, 96 * dpr])
        expect(context.canvas.style).toMatchObject({ width: '160px', height: '96px' })
      } finally {
        h.terminal.dispose()
      }
    }
  )

  it.each([2, 1])(
    'maps natural-size Kitty pixels one-to-one to device pixels at DPR %i',
    async (dpr) => {
      const h = createTerminal(dpr)
      try {
        const pixels = Buffer.alloc(32 * 64 * 4, 255).toString('base64')
        await writeKitty(h.terminal, 'a=T,f=32,s=32,v=64,i=7,C=1', pixels)
        expect(h.replies.map((reply) => reply.slice(3, -2))).toEqual(['i=7;OK'])
        const cols = 4 / dpr
        const rows = 4 / dpr
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            expect(h.addon.getImageAtBufferCell(col, row)).toMatchObject({ width: 32, height: 64 })
          }
        }
        expect(h.addon.getImageAtBufferCell(cols, 0)).toBeUndefined()
        expect(h.addon.getImageAtBufferCell(0, rows)).toBeUndefined()
        expect(h.addon.extractTileAtBufferCell(0, 0)).toMatchObject({
          width: 8 * dpr,
          height: 16 * dpr
        })
      } finally {
        h.terminal.dispose()
      }
    }
  )

  it('reports device cells and a matching cell-times-grid text area when size reports are enabled', async () => {
    const h = createTerminal(2, true)
    const replies = []
    h.terminal.onData((data) => replies.push(data))
    try {
      h.dimensions.mockReturnValue(terminalDimensions(1.25, 8.4, 16.4))
      await write(h.terminal, '\x1b[16t\x1b[14t')
      expect(replies).toEqual(['\x1b[6;21;11t', '\x1b[4;126;220t'])
    } finally {
      h.terminal.dispose()
    }
  })

  it.each(
    ['width', 'height'].flatMap((dimension) =>
      [0, -1, NaN, Infinity, 0.3].map((value) => ({ dimension, value }))
    )
  )('declines size reports with device cell $dimension of $value', async ({ dimension, value }) => {
    const h = createTerminal(2, true)
    try {
      const dimensions = terminalDimensions(2)
      dimensions.device.cell[dimension] = value
      h.dimensions.mockReturnValue(dimensions)
      await write(h.terminal, '\x1b[16t\x1b[14t')
      expect(h.replies).toEqual([])
    } finally {
      h.terminal.dispose()
    }
  })

  it('does not enable pixel size reports when disabled', async () => {
    const h = createTerminal()
    const replies = []
    h.terminal.onData((data) => replies.push(data))
    try {
      await write(h.terminal, '\x1b[16t\x1b[14t')
      expect(replies).toEqual([])
    } finally {
      h.terminal.dispose()
    }
  })
})
