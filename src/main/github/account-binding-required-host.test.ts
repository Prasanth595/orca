import { describe, expect, it, vi } from 'vitest'
import { resolveGhAccountRequiredHost } from './account-binding-required-host'

describe('resolveGhAccountRequiredHost', () => {
  it('does not filter a github.com remote', async () => {
    const resolveAlias = vi.fn()
    await expect(
      resolveGhAccountRequiredHost('example/sample-app', resolveAlias)
    ).resolves.toBeUndefined()
    expect(resolveAlias).not.toHaveBeenCalled()
  })

  it('keeps a real enterprise host without resolving an alias', async () => {
    const resolveAlias = vi.fn()
    await expect(
      resolveGhAccountRequiredHost('ghe.example.com/example/sample-app', resolveAlias)
    ).resolves.toBe('ghe.example.com')
    expect(resolveAlias).not.toHaveBeenCalled()
  })

  it('treats an SSH alias that resolves to github.com as github.com', async () => {
    const resolveAlias = vi.fn(async () => ({ hostname: 'github.com' }))
    await expect(
      resolveGhAccountRequiredHost('github-personal/example/sample-app', resolveAlias)
    ).resolves.toBeUndefined()
    expect(resolveAlias).toHaveBeenCalledWith('github-personal')
  })

  it('folds ssh.github.com and a www prefix back to github.com', async () => {
    await expect(
      resolveGhAccountRequiredHost('github-work/example/sample-app', async () => ({
        hostname: 'ssh.github.com'
      }))
    ).resolves.toBeUndefined()
    await expect(
      resolveGhAccountRequiredHost('github-work/example/sample-app', async () => ({
        hostname: 'www.github.com'
      }))
    ).resolves.toBeUndefined()
  })

  it('uses the resolved enterprise hostname', async () => {
    const resolveAlias = vi.fn(async () => ({ hostname: 'GHE.Example.com' }))
    await expect(
      resolveGhAccountRequiredHost('github-work/example/sample-app', resolveAlias)
    ).resolves.toBe('ghe.example.com')
  })

  it('does not filter when the alias cannot be resolved', async () => {
    const resolveAlias = vi.fn(async () => null)
    await expect(
      resolveGhAccountRequiredHost('github-personal/example/sample-app', resolveAlias)
    ).resolves.toBeUndefined()
  })
})
