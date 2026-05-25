import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const selectMock = mock(async () => 'skip')
const cancelSymbol = Symbol('cancel')
const fetchRemoteMock = mock(async () => true)
const getAheadBehindMock = mock(async () => ({ ahead: 0, behind: 0 }))
const getRemoteBranchRefMock = mock(async () => 'abc123')
const getPorcelainStatusMock = mock(async () => [])
const hasSubmodulePointerChangeMock = mock(async () => false)
const hasLocalCommitsOnOriginMock = mock(async () => false)
const mergeRefMock = mock(async () => true)
const rebaseOntoMock = mock(async () => true)
const stagePathsMock = mock(async () => true)
const commitWithMessageMock = mock(async () => true)
const unstagePathsMock = mock(async () => true)
const noteMock = mock(() => {})
const getRemoteUrlMock = mock(async (_dir: string, name: string) => (
  name === 'origin'
    ? 'https://github.com/acme/repo.git'
    : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
))
const getCurrentBranchMock = mock(async () => 'main')
const isGitRepoRootMock = mock(async () => true)
const resolveGitHubTokenMock = mock(async () => null)
const consoleLogMock = mock(() => {})

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  cancel: mock(() => {}),
  outro: mock(() => {}),
  note: noteMock,
  select: selectMock,
  confirm: confirmMock,
  isCancel: mock((value: unknown) => value === cancelSymbol),
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
    step: mock(() => {}),
    warn: mock(() => {}),
  },
}))

mock.module('../src/commands/repo/internal/git.ts', () => ({
  abortMerge: mock(async () => true),
  abortRebase: mock(async () => true),
  checkoutBranch: mock(async () => true),
  checkoutNewBranchAtHead: mock(async () => true),
  checkoutConflictSide: mock(async () => true),
  cloneRepository: mock(async () => true),
  commitNoEdit: mock(async () => true),
  commitWithMessage: commitWithMessageMock,
  continueRebase: mock(async () => true),
  deinitSubmodules: mock(async () => true),
  dryRunPushCurrentBranch: mock(async () => true),
  ensureRemote: mock(async () => 'unchanged'),
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: fetchRemoteMock,
  getAheadBehind: getAheadBehindMock,
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: getCurrentBranchMock,
  getPorcelainStatus: getPorcelainStatusMock,
  hasSubmodulePointerChange: hasSubmodulePointerChangeMock,
  hasLocalCommitsOnOrigin: hasLocalCommitsOnOriginMock,
  getRemoteBranchRef: getRemoteBranchRefMock,
  getRemoteUrl: getRemoteUrlMock,
  initSubmodules: mock(async () => true),
  initGitRepo: mock(async () => true),
  isGitRepo: mock(async () => true),
  isGitRepoRoot: isGitRepoRootMock,
  isShallowRepo: mock(async () => false),
  isSubmoduleCommitOnHead: mock(async () => true),
  isSubmoduleCommitPushed: mock(async () => true),
  listLocalBranches: mock(async () => []),
  listRemoteBranches: mock(async () => ['main']),
  mergeRef: mergeRefMock,
  pushCurrentBranch: mock(async () => true),
  rebaseOnto: rebaseOntoMock,
  removeRemote: mock(async () => {}),
  stagePaths: stagePathsMock,
  unstagePaths: unstagePathsMock,
  unshallowRepo: mock(async () => true),
}))

mock.module('../src/commands/repo/internal/github-token.ts', () => ({
  resolveGitHubToken: resolveGitHubTokenMock,
}))

const { repoSyncAction } = await import('../src/commands/repo/sync.ts')

function makeGitmodulesContent(url = 'https://github.com/acme/repo.git'): string {
  return [
    '[submodule "backend"]',
    '  path = backend',
    `  url = ${url}`,
    '[submodule "frontend"]',
    '  path = frontend',
    `  url = ${url}`,
    '',
  ].join('\n')
}

function makeProject(gitmodulesContent = makeGitmodulesContent()): string {
  const projectDir = join(tmpdir(), `fba-repo-sync-command-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(projectDir, 'backend'), { recursive: true })
  mkdirSync(join(projectDir, 'frontend'), { recursive: true })
  writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
    name: 'demo',
    backend_name: 'backend',
    frontend_name: 'frontend',
  }), 'utf-8')
  writeFileSync(join(projectDir, '.gitmodules'), gitmodulesContent, 'utf-8')
  return projectDir
}

describe('repo sync command flow', () => {
  const dirs: string[] = []
  const originalConsoleLog = console.log

  beforeEach(() => {
    console.log = consoleLogMock as unknown as typeof console.log
    consoleLogMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockImplementation(async () => false)
    selectMock.mockReset()
    selectMock.mockImplementation(async () => 'skip')
    fetchRemoteMock.mockReset()
    fetchRemoteMock.mockImplementation(async () => true)
    getAheadBehindMock.mockReset()
    getAheadBehindMock.mockImplementation(async () => ({ ahead: 0, behind: 0 }))
    getRemoteBranchRefMock.mockReset()
    getRemoteBranchRefMock.mockImplementation(async () => 'abc123')
    getPorcelainStatusMock.mockReset()
    getPorcelainStatusMock.mockImplementation(async () => [])
    hasSubmodulePointerChangeMock.mockReset()
    hasSubmodulePointerChangeMock.mockImplementation(async () => false)
    hasLocalCommitsOnOriginMock.mockReset()
    hasLocalCommitsOnOriginMock.mockImplementation(async () => false)
    mergeRefMock.mockReset()
    mergeRefMock.mockImplementation(async () => true)
    rebaseOntoMock.mockReset()
    rebaseOntoMock.mockImplementation(async () => true)
    stagePathsMock.mockReset()
    stagePathsMock.mockImplementation(async () => true)
    commitWithMessageMock.mockReset()
    commitWithMessageMock.mockImplementation(async () => true)
    unstagePathsMock.mockReset()
    unstagePathsMock.mockImplementation(async () => true)
    getRemoteUrlMock.mockReset()
    getRemoteUrlMock.mockImplementation(async (_dir: string, name: string) => (
      name === 'origin'
        ? 'https://github.com/acme/repo.git'
        : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
    ))
    getCurrentBranchMock.mockReset()
    getCurrentBranchMock.mockImplementation(async () => 'main')
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    resolveGitHubTokenMock.mockReset()
    resolveGitHubTokenMock.mockImplementation(async () => null)
    noteMock.mockReset()
  })

  afterEach(() => {
    console.log = originalConsoleLog
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('does not fetch remotes before the target project is confirmed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)

    await repoSyncAction({ projectDir })

    expect(confirmMock).toHaveBeenCalled()
    expect(fetchRemoteMock).not.toHaveBeenCalled()
  })

  test('handles existing main pointer changes before fetching child remotes', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
  })

  test('does not commit startup main pointer changes when main has no current branch', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? null : 'main'
    ))
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
  })

  test('offers to commit main repository submodule pointer changes after child sync', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    getAheadBehindMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend')
        ? { ahead: 0, behind: 1 }
        : { ahead: 0, behind: 0 }
    ))
    let mainStatusReads = 0
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && ++mainStatusReads > 1 ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: sync repository pointers')
  })

  test('does not commit submodule pointers when only the main repository moved', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValue('fast-forward-origin')
    getAheadBehindMock.mockImplementation(async (dir: string) => (
      dir === projectDir
        ? { ahead: 0, behind: 1 }
        : { ahead: 0, behind: 0 }
    ))
    let mainStatusReads = 0
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && ++mainStatusReads > 1 ? [' M backend'] : []
    ))

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
  })

  test('rebuilds child sync decisions after the main repository moves', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValue('fast-forward-origin')
    let mainUpdated = false
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      if (dir.endsWith('backend')) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) mainUpdated = true
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(mergeRefMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
  })

  test('checks upstream after child origin updates against the current child head', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValue('fast-forward-origin')
    let backendUpdatedFromOrigin = false
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef.startsWith('origin/')) {
        return backendUpdatedFromOrigin ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      if (dir.endsWith('backend') && remoteRef.startsWith('upstream/')) {
        return backendUpdatedFromOrigin ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir.endsWith('backend')) backendUpdatedFromOrigin = true
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
    expect(mergeRefMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'upstream/main', { ffOnly: true })
  })

  test('continues to child origin sync when main fast-forward temporarily changes submodule pointers', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValue('fast-forward-origin')
    let mainUpdated = false
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      if (dir.endsWith('backend')) {
        return { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && mainUpdated ? [' M backend'] : []
    ))
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) mainUpdated = true
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
  })

  test('stops when main origin leaves unresolved submodule pointer changes and no child moved', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    let mainUpdated = false
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && mainUpdated ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) mainUpdated = true
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('未同步: 1'),
      expect.any(String),
    )
  })

  test('lets main origin refresh repair stale gitmodules before syncing children', async () => {
    const projectDir = makeProject(makeGitmodulesContent('https://github.com/acme/old.git'))
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    let mainAheadBehindReads = 0
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        mainAheadBehindReads += 1
        return mainAheadBehindReads === 1 ? { ahead: 0, behind: 1 } : { ahead: 0, behind: 0 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        writeFileSync(join(projectDir, '.gitmodules'), makeGitmodulesContent(), 'utf-8')
      }
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(selectMock).toHaveBeenCalledTimes(1)
  })

  test('does not commit submodule pointers for dirty-only child worktrees after child sync', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    getAheadBehindMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend')
        ? { ahead: 0, behind: 1 }
        : { ahead: 0, behind: 0 }
    ))
    let mainStatusReads = 0
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && ++mainStatusReads > 1 ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockResolvedValue(false)

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
  })

  test('offers to commit existing main pointer changes before syncing remotes', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    let committed = false
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && !committed ? [' M backend'] : []
    ))
    commitWithMessageMock.mockImplementationOnce(async () => {
      committed = true
      return true
    })
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: sync repository pointers')
    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(selectMock).not.toHaveBeenCalled()
  })

  test('unstages startup main pointer changes when the local commit fails', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    commitWithMessageMock.mockResolvedValueOnce(false)

    await repoSyncAction({ projectDir })

    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: sync repository pointers')
    expect(unstagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
  })

  test('keeps discovered token when rebuilding the sync plan after committing existing main pointers', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    resolveGitHubTokenMock.mockResolvedValueOnce({ source: 'GITHUB_TOKEN', token: 'token' })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    let committed = false
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && !committed ? [' M backend'] : []
    ))
    commitWithMessageMock.mockImplementationOnce(async () => {
      committed = true
      return true
    })
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin', { authToken: 'token' })
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin', { authToken: 'token' })
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin', { authToken: 'token' })
  })

  test('keeps discovered token when rebuilding the sync plan after main origin updates', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    resolveGitHubTokenMock.mockResolvedValueOnce({ source: 'GITHUB_TOKEN', token: 'token' })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    let mainUpdated = false
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementationOnce(async () => {
      mainUpdated = true
      return true
    })

    await repoSyncAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin', { authToken: 'token' })
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin', { authToken: 'token' })
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin', { authToken: 'token' })
  })

  test('stops when existing main pointer changes are not committed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')

    await repoSyncAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(selectMock).not.toHaveBeenCalled()
  })

  test('does not treat dirty gitmodules as an existing main pointer change', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? ['M  .gitmodules'] : []
    ))

    await repoSyncAction({ projectDir })

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(selectMock).not.toHaveBeenCalled()
  })

  test('lets main origin refresh repair stale project config before checking children', async () => {
    const projectDir = join(tmpdir(), `fba-repo-sync-command-stale-config-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'demo',
      backend_name: 'old-backend',
      frontend_name: 'old-frontend',
    }), 'utf-8')
    writeFileSync(join(projectDir, '.gitmodules'), [
      '[submodule "old-backend"]',
      '  path = old-backend',
      '  url = https://github.com/acme/old-backend.git',
      '[submodule "old-frontend"]',
      '  path = old-frontend',
      '  url = https://github.com/acme/old-frontend.git',
      '',
    ].join('\n'), 'utf-8')
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    let mainUpdated = false
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        return mainUpdated ? { ahead: 0, behind: 0 } : { ahead: 0, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        mainUpdated = true
        mkdirSync(join(projectDir, 'backend'), { recursive: true })
        mkdirSync(join(projectDir, 'frontend'), { recursive: true })
        writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
          name: 'demo',
          backend_name: 'backend',
          frontend_name: 'frontend',
        }), 'utf-8')
        writeFileSync(join(projectDir, '.gitmodules'), makeGitmodulesContent(), 'utf-8')
      }
      return true
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(mergeRefMock).not.toHaveBeenCalledWith(join(projectDir, 'old-backend'), 'origin/main', { ffOnly: true })
    expect(selectMock).toHaveBeenCalledTimes(1)
  })

  test('continues with the current project plan when the user skips main precheck refresh', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock
      .mockResolvedValueOnce('skip')
      .mockResolvedValueOnce('fast-forward-origin')
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) return { ahead: 0, behind: 1 }
      if (dir.endsWith('backend')) return { ahead: 0, behind: 1 }
      return { ahead: 0, behind: 0 }
    })

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).not.toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: true })
    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
    expect(selectMock).toHaveBeenCalledTimes(2)
  })

  test('does not merge main before full precheck when main origin is diverged', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend') ? [' M app.py'] : []
    ))
    getAheadBehindMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? { ahead: 1, behind: 1 } : { ahead: 0, behind: 0 }
    ))
    selectMock.mockResolvedValueOnce('merge-origin')

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).not.toHaveBeenCalledWith(projectDir, 'origin/main', { ffOnly: false })
    expect(rebaseOntoMock).not.toHaveBeenCalledWith(projectDir, 'origin/main')
    expect(selectMock).not.toHaveBeenCalled()
  })

  test('counts main precheck refresh in the sync summary', async () => {
    const projectDir = makeProject(makeGitmodulesContent('https://github.com/acme/old.git'))
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    let mainAheadBehindReads = 0
    getAheadBehindMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        mainAheadBehindReads += 1
        return mainAheadBehindReads === 1 ? { ahead: 0, behind: 1 } : { ahead: 0, behind: 0 }
      }
      return { ahead: 0, behind: 0 }
    })
    mergeRefMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) {
        writeFileSync(join(projectDir, '.gitmodules'), makeGitmodulesContent(), 'utf-8')
      }
      return true
    })

    await repoSyncAction({ projectDir })

    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('已更新: 1'),
      expect.any(String),
    )
  })

  test('counts upstream fetch failures as failed work in the sync summary', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    fetchRemoteMock.mockImplementation(async (dir: string, remote: string) => (
      remote === 'upstream' && dir.endsWith('backend') ? false : true
    ))

    await repoSyncAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'upstream')
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('仓库同步失败: 1'),
      expect.any(String),
    )
  })

  test('prints the origin summary when upstream follow-up is cancelled', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(cancelSymbol)
    selectMock.mockResolvedValueOnce('fast-forward-origin')
    getAheadBehindMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend')
        ? { ahead: 0, behind: 1 }
        : { ahead: 0, behind: 0 }
    ))

    await repoSyncAction({ projectDir })

    expect(mergeRefMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin/main', { ffOnly: true })
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('已更新: 1'),
      expect.any(String),
    )
  })

  test('does not commit submodule pointers after upstream phase unless a child repository moved', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValue('skip')
    let mainStatusReads = 0
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir && ++mainStatusReads > 1 ? [' M backend'] : []
    ))

    await repoSyncAction({ projectDir })

    expect(confirmMock).toHaveBeenCalledTimes(2)
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
  })

  test('recommends upstream rebase when local commits are not on origin yet', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValue('skip')
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef.startsWith('origin/')) {
        return { ahead: 1, behind: 0 }
      }
      if (dir.endsWith('backend') && remoteRef.startsWith('upstream/')) {
        return { ahead: 1, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })

    await repoSyncAction({ projectDir })

    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'rebase-upstream',
    }))
  })

  test('skips upstream ahead without prompting for merge or rebase', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock.mockResolvedValue('skip')
    getAheadBehindMock.mockImplementation(async (_dir: string, _localRef: string, remoteRef: string) => (
      remoteRef.startsWith('upstream/')
        ? { ahead: 1, behind: 0 }
        : { ahead: 0, behind: 0 }
    ))

    await repoSyncAction({ projectDir })

    expect(selectMock).not.toHaveBeenCalled()
    expect(noteMock).not.toHaveBeenCalledWith(
      expect.stringContaining('merge-upstream'),
      expect.any(String),
    )
    expect(noteMock).not.toHaveBeenCalledWith(
      expect.stringContaining('rebase-upstream'),
      expect.any(String),
    )
  })

  test('preserves published-commit warning after choosing a different upstream branch', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock
      .mockResolvedValueOnce('choose-upstream-branch')
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('skip')
    let backendUpstreamRefReads = 0
    getRemoteBranchRefMock.mockImplementation(async (dir: string, _branch: string, remote = 'origin') => {
      if (remote === 'upstream' && dir.endsWith('backend')) {
        backendUpstreamRefReads += 1
        return backendUpstreamRefReads === 1 ? null : 'def456'
      }
      return 'abc123'
    })
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef.startsWith('upstream/')) {
        return { ahead: 1, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })

    await repoSyncAction({ projectDir })

    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'merge-upstream',
    }))
  })

  test('cancels upstream sync when the chosen branch action is cancelled', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock
      .mockResolvedValueOnce('choose-upstream-branch')
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce(cancelSymbol)
    let backendUpstreamRefReads = 0
    getRemoteBranchRefMock.mockImplementation(async (dir: string, _branch: string, remote = 'origin') => {
      if (remote === 'upstream' && dir.endsWith('backend')) {
        backendUpstreamRefReads += 1
        return backendUpstreamRefReads === 1 ? null : 'def456'
      }
      return 'abc123'
    })
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef.startsWith('upstream/')) {
        return { ahead: 1, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })

    await repoSyncAction({ projectDir })

    expect(selectMock).toHaveBeenCalledTimes(3)
    expect(mergeRefMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'upstream/main', expect.anything())
    expect(rebaseOntoMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'upstream/main')
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('未同步: 1'),
      expect.any(String),
    )
  })

  test('recommends merge for origin diverged branches when local commits exist on origin', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    selectMock.mockResolvedValueOnce('skip')
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef === 'origin/main') {
        return { ahead: 1, behind: 1 }
      }
      return { ahead: 0, behind: 0 }
    })
    hasLocalCommitsOnOriginMock.mockImplementation(async (dir: string) => dir.endsWith('backend'))

    await repoSyncAction({ projectDir })

    expect(hasLocalCommitsOnOriginMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'merge-origin',
    }))
  })

  test('skips chosen upstream branch when it has no incoming commits', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock
      .mockResolvedValueOnce('choose-upstream-branch')
      .mockResolvedValueOnce('main')
    let backendUpstreamRefReads = 0
    getRemoteBranchRefMock.mockImplementation(async (dir: string, _branch: string, remote = 'origin') => {
      if (remote === 'upstream' && dir.endsWith('backend')) {
        backendUpstreamRefReads += 1
        return backendUpstreamRefReads === 1 ? null : 'def456'
      }
      return 'abc123'
    })
    getAheadBehindMock.mockImplementation(async (dir: string, _localRef: string, remoteRef: string) => {
      if (dir.endsWith('backend') && remoteRef.startsWith('upstream/')) {
        return { ahead: 2, behind: 0 }
      }
      return { ahead: 0, behind: 0 }
    })

    await repoSyncAction({ projectDir })

    expect(selectMock).toHaveBeenCalledTimes(2)
    expect(selectMock).not.toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'merge-upstream',
    }))
    expect(selectMock).not.toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'rebase-upstream',
    }))
  })

  test('cancels upstream sync when upstream branch selection is cancelled', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    selectMock
      .mockResolvedValueOnce('choose-upstream-branch')
      .mockResolvedValueOnce(cancelSymbol)
    getRemoteBranchRefMock.mockImplementation(async (dir: string, _branch: string, remote = 'origin') => (
      remote === 'upstream' && dir.endsWith('backend') ? null : 'abc123'
    ))

    await repoSyncAction({ projectDir })

    expect(selectMock).toHaveBeenCalledTimes(2)
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('未同步: 1'),
      expect.any(String),
    )
  })

  test('does not read inherited parent Git state for child directories that are not Git roots', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir === projectDir)

    await repoSyncAction({ projectDir })

    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
    expect(getCurrentBranchMock).toHaveBeenCalledWith(projectDir)
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'))
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'))
    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(fetchRemoteMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
  })

  test('handles unreadable gitmodules without crashing', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    rmSync(join(projectDir, '.gitmodules'), { force: true })
    mkdirSync(join(projectDir, '.gitmodules'))
    confirmMock.mockResolvedValueOnce(true)

    await expect(repoSyncAction({ projectDir })).resolves.toBeUndefined()

    expect(consoleLogMock.mock.calls.flat().join('\n')).toContain('Unable to read')
    expect(noteMock).not.toHaveBeenCalled()
    expect(selectMock).not.toHaveBeenCalled()
  })
})
