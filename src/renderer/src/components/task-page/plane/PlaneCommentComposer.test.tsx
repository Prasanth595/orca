// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaneCommentComposer } from './PlaneCommentComposer'

const mocks = vi.hoisted(() => {
  const platform: { current: NodeJS.Platform } = { current: 'darwin' }
  return { addComment: vi.fn(), toastError: vi.fn(), platform }
})
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeAddCommentForTarget: mocks.addComment,
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => mocks.platform.current }))
vi.mock('@/components/plane/use-plane-host-label', () => ({
  usePlaneHostLabel: () => 'Local Mac'
}))

const TARGET = { kind: 'local' } as const
const ITEM = { projectId: 'project-1', id: 'item-1', connectionId: 'conn-2' }
const COMMENT = {
  id: 'c1',
  authorName: 'Ada',
  text: 'Looks good',
  createdAt: '2026-01-01T00:00:00Z'
}

function setup() {
  const onCommentAdded = vi.fn()
  render(<PlaneCommentComposer item={ITEM} target={TARGET} onCommentAdded={onCommentAdded} />)
  const box = screen.getByRole('textbox', { name: 'Comment' })
  fireEvent.change(box, { target: { value: '  Looks good  ' } })
  return { onCommentAdded, box }
}

beforeEach(() => {
  mocks.addComment.mockReset()
  mocks.toastError.mockReset()
  mocks.platform.current = 'darwin'
})
afterEach(cleanup)

describe('PlaneCommentComposer', () => {
  it('submits with Cmd+Enter on macOS, not Ctrl+Enter', async () => {
    mocks.addComment.mockResolvedValue({ ok: true, value: COMMENT })
    const { onCommentAdded, box } = setup()
    expect(screen.getByText('⌘ Enter to comment')).toBeTruthy()

    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(mocks.addComment).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onCommentAdded).toHaveBeenCalledWith(COMMENT))
    expect(mocks.addComment).toHaveBeenCalledWith(TARGET, {
      connectionId: 'conn-2',
      projectId: 'project-1',
      workItemId: 'item-1',
      text: 'Looks good'
    })
    expect(box).toHaveProperty('value', '')
  })

  it('submits with Ctrl+Enter elsewhere, not Cmd+Enter', async () => {
    mocks.platform.current = 'linux'
    mocks.addComment.mockResolvedValue({ ok: true, value: COMMENT })
    const { box } = setup()
    expect(screen.getByText('Ctrl+Enter to comment')).toBeTruthy()

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(mocks.addComment).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledOnce())
  })

  it('sends one comment for a fast double submit', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.addComment.mockReturnValue(new Promise((done) => (resolve = done)))
    const { box } = setup()

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(mocks.addComment).toHaveBeenCalledOnce()
    await act(async () => resolve({ ok: true, value: COMMENT }))
  })

  it('keeps the draft and shows a toast on failure, without retrying', async () => {
    mocks.addComment.mockResolvedValue({ ok: false, error: { kind: 'forbidden', message: 'x' } })
    const { onCommentAdded, box } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You don't have permission to change this work item in Plane."
      )
    )
    expect(mocks.addComment).toHaveBeenCalledOnce()
    expect(onCommentAdded).not.toHaveBeenCalled()
    expect(box).toHaveProperty('value', '  Looks good  ')
  })

  it('does not submit an empty comment', () => {
    render(<PlaneCommentComposer item={ITEM} target={TARGET} onCommentAdded={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Enter',
      metaKey: true
    })
    expect(mocks.addComment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveProperty('disabled', true)
  })
})
