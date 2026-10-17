import { useMemo } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatTaskList } from './NativeChatTaskList'
import { nativeChatTaskListState } from './native-chat-task-list-state'

/**
 * The conversation's current task list, docked under the transcript.
 *
 * Why the always-mounted collapse wrapper instead of `return null`: when the
 * first task list docks or the session's list clears, the composer area used
 * to jump by its full height in one frame. The grid-rows bridge grows and
 * shrinks it with the content instead.
 */
export function NativeChatDockedTaskList({
  messages
}: {
  messages: readonly NativeChatMessage[]
}): React.JSX.Element {
  const { list } = useMemo(() => nativeChatTaskListState(messages), [messages])
  const hasList = Boolean(list && list.tasks.length > 0)
  return (
    <div
      className="grid shrink-0 grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none data-[has-list=true]:grid-rows-[1fr]"
      data-has-list={hasList}
      aria-hidden={!hasList}
    >
      <div className="min-h-0 overflow-hidden">
        {hasList && list ? (
          <div className="px-3 pb-2 sm:px-4">
            <div className="mx-auto w-full max-w-(--chat-content-max-width)">
              <NativeChatTaskList list={list} presentation="composer" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
