import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
const deinitSubmodulesMock = mock(async () => true)
const deleteLocalBranchMock = mock(async () => true)
const getCurrentBranchMock = mock(async () => 'main')
const getHeadCommitMock = mock(async () => 'HEAD')
const isGitRepoRootMock = mock(async () => true)
const listLocalBranchesMock = mock(async () => ['main'])
const checkoutExistingBranchMock = mock(async () => true)
const checkoutDetachedMock = mock(async () => true)

mock.module('../src/commands/repo/internal/git.ts', () => ({
  checkoutDetached: checkoutDetachedMock,
  checkoutExistingBranch: checkoutExistingBranchMock,
  deleteLocalBranch: deleteLocalBranchMock,
  deinitSubmodules: deinitSubmodulesMock,
  getRemoteUrl: getRemoteUrlMock,
  getCurrentBranch: getCurrentBranchMock,
  getHeadCommit: getHeadCommitMock,
  isGitRepoRoot: isGitRepoRootMock,
  listLocalBranches: listLocalBranchesMock,
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
    deleteLocalBranchMock.mockClear()
    deinitSubmodulesMock.mockClear()
    getCurrentBranchMock.mockReset()
    getCurrentBranchMock.mockImplementation(async () => 'main')
    getHeadCommitMock.mockReset()
    getHeadCommitMock.mockImplementation(async () => 'HEAD')
    listLocalBranchesMock.mockReset()
    listLocalBranchesMock.mockImplementation(async () => ['main'])
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    checkoutExistingBranchMock.mockReset()
    checkoutExistingBranchMock.mockImplementation(async () => true)
    checkoutDetachedMock.mockReset()
    checkoutDetachedMock.mockImplementation(async () => true)
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

  test('removes child repository directories created during init rollback', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    mkdirSync(backendDir, { recursive: true })
    writeFileSync(join(backendDir, '.git'), 'gitdir: ../.git/modules/backend', 'utf-8')
    mkdirSync(frontendDir, { recursive: true })
    writeFileSync(join(frontendDir, '.git'), 'gitdir: ../.git/modules/frontend', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(existsSync(backendDir)).toBe(false)
    expect(existsSync(frontendDir)).toBe(false)
  })

  test('cleans submodule metadata created during init rollback', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    mkdirSync(join(projectDir, '.git', 'modules', 'backend'), { recursive: true })
    writeFileSync(join(projectDir, '.git', 'modules', 'backend', 'config'), 'created', 'utf-8')
    mkdirSync(join(projectDir, '.git', 'modules', 'frontend'), { recursive: true })
    writeFileSync(join(projectDir, '.git', 'modules', 'frontend', 'config'), 'created', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(deinitSubmodulesMock).toHaveBeenCalledWith(projectDir, ['backend', 'frontend'])
    expect(existsSync(join(projectDir, '.git', 'modules', 'backend'))).toBe(false)
    expect(existsSync(join(projectDir, '.git', 'modules', 'frontend'))).toBe(false)
  })

  test('keeps existing submodule metadata during init rollback', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)
    mkdirSync(join(projectDir, '.git', 'modules', 'backend'), { recursive: true })
    writeFileSync(join(projectDir, '.git', 'modules', 'backend', 'config'), 'existing', 'utf-8')

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    mkdirSync(join(projectDir, '.git', 'modules', 'frontend'), { recursive: true })
    writeFileSync(join(projectDir, '.git', 'modules', 'frontend', 'config'), 'created', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(deinitSubmodulesMock).toHaveBeenCalledWith(projectDir, ['frontend'])
    expect(readFileSync(join(projectDir, '.git', 'modules', 'backend', 'config'), 'utf-8')).toBe('existing')
    expect(existsSync(join(projectDir, '.git', 'modules', 'frontend'))).toBe(false)
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

  test('does not snapshot or restore child remotes when child directories are not Git roots', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)
    mkdirSync(backendDir, { recursive: true })
    mkdirSync(frontendDir, { recursive: true })
    setRemote(projectDir, 'origin', 'https://example.test/original/project.git')
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir === projectDir)

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    setRemote(projectDir, 'origin', 'https://example.test/changed/project.git')
    writeFileSync(join(backendDir, '.git'), 'gitdir: ../.git/modules/backend', 'utf-8')
    writeFileSync(join(backendDir, 'created.txt'), 'created during init', 'utf-8')
    writeFileSync(join(frontendDir, '.git'), 'gitdir: ../.git/modules/frontend', 'utf-8')
    writeFileSync(join(frontendDir, 'created.txt'), 'created during init', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(backendDir, 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(frontendDir, 'origin')
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://example.test/original/project.git',
    )
    expect(ensureRemoteMock).not.toHaveBeenCalledWith(
      backendDir,
      expect.any(String),
      expect.any(String),
    )
    expect(removeRemoteMock).not.toHaveBeenCalledWith(backendDir, expect.any(String))
    expect(checkoutExistingBranchMock).not.toHaveBeenCalledWith(backendDir, expect.any(String))
    expect(checkoutDetachedMock).not.toHaveBeenCalledWith(frontendDir, expect.any(String))
    expect(readdirSync(backendDir)).toEqual([])
    expect(readdirSync(frontendDir)).toEqual([])
  })

  test('preserves pre-existing non-empty non-Git child directories during rollback', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)
    mkdirSync(backendDir, { recursive: true })
    mkdirSync(frontendDir, { recursive: true })
    writeFileSync(join(backendDir, 'keep.txt'), 'user backend data', 'utf-8')
    writeFileSync(join(frontendDir, 'keep.txt'), 'user frontend data', 'utf-8')
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir === projectDir)

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    writeFileSync(join(backendDir, '.git'), 'gitdir: ../.git/modules/backend', 'utf-8')
    writeFileSync(join(backendDir, 'created.txt'), 'created during init', 'utf-8')
    writeFileSync(join(frontendDir, '.git'), 'gitdir: ../.git/modules/frontend', 'utf-8')
    writeFileSync(join(frontendDir, 'created.txt'), 'created during init', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(readFileSync(join(backendDir, 'keep.txt'), 'utf-8')).toBe('user backend data')
    expect(readFileSync(join(frontendDir, 'keep.txt'), 'utf-8')).toBe('user frontend data')
    expect(existsSync(join(backendDir, 'created.txt'))).toBe(true)
    expect(existsSync(join(frontendDir, 'created.txt'))).toBe(true)
  })

  test('does not deinitialize existing submodules whose section names differ from paths', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)
    mkdirSync(join(projectDir, '.git', 'modules', 'api'), { recursive: true })
    mkdirSync(join(projectDir, '.git', 'modules', 'frontend'), { recursive: true })
    writeFileSync(join(projectDir, '.gitmodules'), [
      '[submodule "api"]',
      '\tpath = backend',
      '\turl = https://github.com/acme/backend.git',
      '[submodule "frontend"]',
      '\tpath = frontend',
      '\turl = https://github.com/acme/frontend.git',
      '',
    ].join('\n'), 'utf-8')

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    mkdirSync(join(projectDir, '.git', 'modules', 'backend'), { recursive: true })

    await restoreRepoInitSnapshot(snapshot)

    expect(deinitSubmodulesMock).not.toHaveBeenCalledWith(projectDir, ['backend'])
    expect(deinitSubmodulesMock).not.toHaveBeenCalledWith(projectDir, ['backend', 'frontend'])
    expect(existsSync(join(projectDir, '.git', 'modules', 'api'))).toBe(true)
  })

  test('removes path-named metadata created beside an existing renamed submodule', async () => {
    const projectDir = makeTempDir()
    const backendDir = join(projectDir, 'backend')
    const frontendDir = join(projectDir, 'frontend')
    dirs.push(projectDir)
    mkdirSync(join(projectDir, '.git', 'modules', 'api'), { recursive: true })
    writeFileSync(join(projectDir, '.gitmodules'), [
      '[submodule "api"]',
      '\tpath = backend',
      '\turl = https://github.com/acme/backend.git',
      '',
    ].join('\n'), 'utf-8')

    const snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
    mkdirSync(join(projectDir, '.git', 'modules', 'backend'), { recursive: true })
    writeFileSync(join(projectDir, '.git', 'modules', 'backend', 'config'), 'created', 'utf-8')

    await restoreRepoInitSnapshot(snapshot)

    expect(deinitSubmodulesMock).not.toHaveBeenCalledWith(projectDir, ['backend'])
    expect(existsSync(join(projectDir, '.git', 'modules', 'api'))).toBe(true)
    expect(existsSync(join(projectDir, '.git', 'modules', 'backend'))).toBe(false)
  })
})
