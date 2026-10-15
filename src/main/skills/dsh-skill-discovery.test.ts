import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverDshSkills } from './dsh-skill-discovery'
import { readDshSkillMetadata } from './dsh-skill-metadata'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-dsh-skills-'))
  directories.push(root)
  const project = join(root, 'project')
  const cwd = join(project, 'subfolder')
  await mkdir(cwd, { recursive: true })
  const dshHome = join(root, 'account-a')
  const agentsHome = join(root, 'agent-config')
  return { root, project, cwd, dshHome, agentsHome }
}

async function skill(path: string, name: string, policy = '', description = name) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `---\nname: ${name}\ndescription: ${description}\n${policy}---\nInstructions\n`
  )
}

describe('DSH default filesystem skill discovery', () => {
  it('uses the nearest git root, flat files, exact bundles, and DSH priority', async () => {
    const input = await fixture()
    // A linked worktree's .git is a file.
    await writeFile(join(input.project, '.git'), 'gitdir: /fixture/main/.git/worktrees/test')
    const projectSkill = join(input.project, '.dsh', 'skills', 'review', 'SKILL.md')
    await skill(projectSkill, 'review', '', 'Project wins')
    await skill(join(input.project, '.agents', 'skills', 'review.md'), 'review')
    await skill(join(input.dshHome, 'skills', 'review', 'SKILL.md'), 'review')
    await skill(join(input.agentsHome, 'skills', 'flat.md'), 'flat')
    await skill(join(input.project, '.dsh', 'skills', 'nested', 'deeper', 'SKILL.md'), 'nested')
    await skill(join(input.dshHome, 'skills', '.system', 'SKILL.md'), 'hidden-system')
    const result = await discoverDshSkills(input)
    expect(result.skills.map((entry) => entry.name).sort()).toEqual(['flat', 'review'])
    expect(result.skills.find((entry) => entry.name === 'review')).toMatchObject({
      description: 'Project wins',
      skillFilePath: projectSkill,
      sourceKind: 'repo'
    })
    expect(result.sources.every((entry) => entry.owner === 'dsh')).toBe(true)
  })

  it('uses the folder cwd without git and hides a user-disabled winner without revealing its shadow', async () => {
    const input = await fixture()
    await skill(
      join(input.cwd, '.dsh', 'skills', 'blocked.md'),
      'blocked',
      'user-invocable: false\n'
    )
    await skill(join(input.dshHome, 'skills', 'blocked.md'), 'blocked')
    await skill(
      join(input.cwd, '.agents', 'skills', 'manual.md'),
      'manual',
      'disable-model-invocation: true\n'
    )
    await skill(join(input.project, '.dsh', 'skills', 'outside.md'), 'outside')
    expect((await discoverDshSkills(input)).skills.map((entry) => entry.name)).toEqual(['manual'])
  })

  it('keeps account roots separate and honors cancellation', async () => {
    const input = await fixture()
    await skill(join(input.dshHome, 'skills', 'private.md'), 'private')
    const otherHome = join(input.root, 'account-b')
    expect((await discoverDshSkills({ ...input, dshHome: otherHome })).skills).toEqual([])
    const controller = new AbortController()
    controller.abort()
    await expect(discoverDshSkills({ ...input, signal: controller.signal })).rejects.toThrow()
  })
})

describe('DSH frontmatter invocation policy', () => {
  it.each(['false', 'no', 'off', '0', '"FALSE"'])('honors user-invocable: %s', (value) => {
    expect(
      readDshSkillMetadata(
        `---\nname: sample\ndescription: Sample\nuser-invocable: ${value}\n---\n`
      )
    ).toMatchObject({ name: 'sample', userInvocable: false })
  })

  it.each([
    'user-invocable: maybe',
    'user-invocable: [yes]',
    'userInvocable: true',
    'disable-model-invocation: null'
  ])('rejects invalid policy %s', (policy) => {
    expect(
      readDshSkillMetadata(`---\nname: sample\ndescription: Sample\n${policy}\n---\n`)
    ).toBeNull()
  })

  it('rejects missing metadata, invalid names, and malformed YAML', () => {
    expect(readDshSkillMetadata('# Not a skill')).toBeNull()
    expect(readDshSkillMetadata('---\nname: invalid_name\ndescription: Sample\n---\n')).toBeNull()
    expect(readDshSkillMetadata('---\nname: sample\ndescription: [\n---\n')).toBeNull()
  })
})
