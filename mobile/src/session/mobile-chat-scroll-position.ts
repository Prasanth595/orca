import { createContext } from 'react'
export type MobileChatScrollPosition = { offset: number; following: boolean }
export const MobileChatScrollPositions = createContext<Map<
  string,
  MobileChatScrollPosition
> | null>(null)
