import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const remoteUrls = new Map<string, string>()

const remoteKey = (dir: string, name: string) => `${dir}:${name}`

const getRemoteUrlMock = mock(async (dir: string, name: string) => {
  return remoteUrls.get(remoteKey(dir, name)) ?? null
})

const ensureRemoteMock = mock(async (dir: string, name: string, url: string) => {
  remoteUrls.set(remoteKey(dir, name), url)
  return 'updated'
})

const removeRemoteMock = mock(async (dir: string, name: string) => {
  remoteUrls.delete(remoteKey(dir, name))
})

mock.module('../src/commands/repo/internal/git.ts', () => ({
  getRemoteUrl: getRemoteUrlMock,
  ensureRemote: ensureRemoteMock,
  removeRemote: removeRemoteMock,
}))

const { createRepoInitSnapshot, restoreRepoInitSnapshot } = await import(
  '../src/commands/repo/internal/transaction.ts'
)

function makeTempDir(): string {
  const dir = join(tmpdir(), `fba-repo-init-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function setRemote(dir: string, name: string, url: string): void {
  remoteUrls.set(remoteKey(dir, name), url)
}

describe('repo init transaction', () => {
  const dirs: string[] = []

  beforeEach(() => {
    remoteUrls.clear()
    getRemoteUrlMock.mockClear()
    ensureRemoteMock.mockClear()
    removeRemoteMock.mockClear()
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('restores existing .gitmodules content', async () => {
    const projectDir = makeTempDir()
    dirs.push(projectDir)
    writeFileSync(join(projectDir, '.gitmodules'), 'before', 'utf-8')

    const snapshot = await createRepoInitSnapshot({
      projectDir,
      backendDir: projectDir,
      frontendDir: projectDir,
    })
    writeFileSync(join(projectDir, '.gitmodules'), 'after', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(readFileSync(join(projectDir, '.gitmodules'), 'utf-8')).toBe('before')
  })

  test('removes .gitmodules when absent before', async () => {
    const projectDir = makeTempDir()
    dirs.push(projectDir)

    const snapshot = await createRepoInitSnapshot({
      projectDir,
      backendDir: projectDir,
      frontendDir: projectDir,
    })
    writeFileSync(join(projectDir, '.gitmodules'), 'after', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(existsSync(join(projectDir, '.gitmodules'))).toBe(false)
  })

  test('removes main .git only when repo init created it', async () => {
    const createdGitDir = makeTempDir()
    const existingGitDir = makeTempDir()
    dirs.push(createdGitDir, existingGitDir)
    mkdirSync(join(existingGitDir, '.git'))

    const createdSnapshot = await createRepoInitSnapshot({
      projectDir: createdGitDir,
      backendDir: createdGitDir,
      frontendDir: createdGitDir,
    })
    const existingSnapshot = await createRepoInitSnapshot({
      projectDir: existingGitDir,
      backendDir: existingGitDir,
      frontendDir: existingGitDir,
    })
    mkdirSync(join(createdGitDir, '.git'))

    await restoreRepoInitSnapshot(createdSnapshot)
    await restoreRepoInitSnapshot(existingSnapshot)

    expect(existsSync(join(createdGitDir, '.git'))).toBe(false)
    expect(existsSync(join(existingGitDir, '.git'))).toBe(true)
  })

  test('restores origin and upstream remotes for project, backend, and frontend dirs', async () => {
    const projectDir = makeTempDir()
    const backendDir = makeTempDir()
    const frontendDir = makeTempDir()
    dirs.push(projectDir, backendDir, frontendDir)
    setRemote(projectDir, 'origin', 'https://example.test/original/project.git')
    setRemote(projectDir, 'upstream', 'https://example.test/original/project-upstream.git')
    setRemote(backendDir, 'origin', 'https://example.test/original/backend.git')
    setRemote(frontendDir, 'upstream', 'https://example.test/original/frontend-upstream.git')

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    setRemote(projectDir, 'origin', 'https://example.test/changed/project.git')
    remoteUrls.delete(remoteKey(projectDir, 'upstream'))
    setRemote(backendDir, 'origin', 'https://example.test/changed/backend.git')
    setRemote(backendDir, 'upstream', 'https://example.test/changed/backend-upstream.git')
    setRemote(frontendDir, 'origin', 'https://example.test/changed/frontend.git')
    setRemote(frontendDir, 'upstream', 'https://example.test/changed/frontend-upstream.git')

    await restoreRepoInitSnapshot(snapshot)

    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://example.test/original/project.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'upstream',
      'https://example.test/original/project-upstream.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      backendDir,
      'origin',
      'https://example.test/original/backend.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      frontendDir,
      'upstream',
      'https://example.test/original/frontend-upstream.git',
    )
    expect(removeRemoteMock).toHaveBeenCalledWith(backendDir, 'upstream')
    expect(removeRemoteMock).toHaveBeenCalledWith(frontendDir, 'origin')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'upstream')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(backendDir, 'origin')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(backendDir, 'upstream')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(frontendDir, 'origin')
    expect(getRemoteUrlMock).toHaveBeenCalledWith(frontendDir, 'upstream')
    expect(remoteUrls.get(remoteKey(projectDir, 'origin'))).toBe(
      'https://example.test/original/project.git',
    )
    expect(remoteUrls.get(remoteKey(projectDir, 'upstream'))).toBe(
      'https://example.test/original/project-upstream.git',
    )
    expect(remoteUrls.get(remoteKey(backendDir, 'origin'))).toBe(
      'https://example.test/original/backend.git',
    )
    expect(remoteUrls.has(remoteKey(backendDir, 'upstream'))).toBe(false)
    expect(remoteUrls.has(remoteKey(frontendDir, 'origin'))).toBe(false)
    expect(remoteUrls.get(remoteKey(frontendDir, 'upstream'))).toBe(
      'https://example.test/original/frontend-upstream.git',
    )
  })
})
