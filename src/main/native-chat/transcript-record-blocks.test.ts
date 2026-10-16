import { expect, it } from 'vitest'
import { claudeContentBlocks } from './transcript-record-blocks'

it('keeps the owning-host path as the only source of a historical image', () => {
  expect(
    claudeContentBlocks([
      {
        type: 'image',
        path: '/host/agent-session-attachments/upload/image.png',
        source: { url: 'https://expired.example/image.png' },
        alt: 'Screenshot'
      }
    ])
  ).toEqual([
    {
      type: 'image-ref',
      path: '/host/agent-session-attachments/upload/image.png',
      alt: 'Screenshot'
    }
  ])
})

it('retains a URL when the historical image has no owning-host path', () => {
  expect(
    claudeContentBlocks([{ type: 'image', source: { url: 'https://example.test/image.png' } }])
  ).toEqual([{ type: 'image-ref', url: 'https://example.test/image.png' }])
})
