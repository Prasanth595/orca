import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RepositoryIconTabs } from './RepositoryIconTabs'

vi.mock('../ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

function render(onUseGitHubAvatar?: () => void): string {
  return renderToStaticMarkup(
    <RepositoryIconTabs
      initialTab="avatar"
      selectedLucideName={null}
      selectedEmoji=""
      loadingGitHub={false}
      onSetIcon={vi.fn()}
      onUseGitHubAvatar={onUseGitHubAvatar}
    />
  )
}

describe('RepositoryIconTabs', () => {
  it('offers the GitHub avatar for repositories', () => {
    const markup = render(vi.fn())
    expect(markup).toContain('Avatar')
    expect(markup).toContain('Use GitHub Avatar')
  })

  it('labels the tab Image and drops the GitHub button for project groups', () => {
    const markup = render()
    expect(markup).toContain('Image')
    expect(markup).not.toContain('Use GitHub Avatar')
  })
})
