type RowBox = { y: number; height: number }

/** Keep a surviving row at its screen position when process rows are inserted or removed. */
export class MobileChatDisclosureAnchor {
  private boxes = new Map<string, RowBox>()
  private offset = 0
  private viewport = Infinity
  private held: { id: string; top: number }[] | null = null

  recordRow(id: string, box: RowBox): void {
    this.boxes.set(id, box)
  }

  recordOffset(offset: number, viewport = Infinity): void {
    this.offset = offset
    this.viewport = viewport
  }

  hold(ids: readonly string[]): void {
    const rows = ids.flatMap((id) => {
      const box = this.boxes.get(id)
      return box ? [{ id, ...box }] : []
    })
    // Prefer a visible survivor; when the reader's process disappears, fall back to its opener.
    this.held = [
      ...rows
        .filter((row) => row.y + row.height > this.offset && row.y < this.offset + this.viewport)
        .map((row) => ({ id: row.id, top: row.y - this.offset })),
      ...rows
        .filter((row) => row.y + row.height <= this.offset)
        .toReversed()
        .map((row) => ({ id: row.id, top: 0 }))
    ]
  }

  restore(ids: readonly string[]): number | null {
    const present = new Set(ids)
    const anchor = this.held?.find((row) => present.has(row.id))
    this.held = null
    if (!anchor) {
      return null
    }
    const box = this.boxes.get(anchor.id)
    if (!box) {
      return null
    }
    const top = Math.max(anchor.top, -Math.max(0, box.height - 1))
    return Math.max(0, box.y - top)
  }

  retain(ids: readonly string[]): void {
    const present = new Set(ids)
    for (const id of this.boxes.keys()) {
      if (!present.has(id)) {
        this.boxes.delete(id)
      }
    }
  }
}
