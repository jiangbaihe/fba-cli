import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const multiselectMock = mock(async () => ['backend', 'frontend', 'main'])
const stagePathsMock = mock(async () => true)
const commitWithMessageMock = mock(async () => true)
const unstagePathsMock = mock(async () => true)
const dryRunPushMock = mock(async () => true)
const getPorcelainStatusMock = mock(async () => [])
const getSubmoduleCommitsInMainRangeMock = mock(async () => ({
  backend: ['backend-commit'],
  frontend: ['frontend-commit'],
}))
const hasSubmodulePointerChangeMock = mock(async () => false)
const getHeadCommitMock = mock(async () => 'child-head')
const isCommitOnHeadMock = mock(async () => true)
const isCommitPushedMock = mock(async () => true)
const isSubmoduleCommitOnHeadMock = mock(async () => true)
const isSubmoduleCommitPushedMock = mock(async () => true)
const fetchRemoteMock = mock(async () => true)
const getRemoteUrlMock = mock(async (_dir: string, name: string) => (
  name === 'origin'
    ? 'https://github.com/acme/repo.git'
    : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
))
const isShallowRepoMock = mock(async () => false)
const pushCurrentBranchMock = mock(async () => true)
const getCurrentBranchMock = mock(async () => 'main')
const isGitRepoRootMock = mock(async () => true)
const resolveGitHubTokenMock = mock(async () => null)
const cancelSymbol = Symbol('cancel')
const cancelMock = mock(() => {})
const consoleLogMock = mock(() => {})

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  cancel: cancelMock,
  outro: mock(() => {}),
  note: mock(() => {}),
  multiselect: multiselectMock,
  select: mock(async () => 'exit'),
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
  checkoutConflictSide: mock(async () => true),
  cloneRepository: mock(async () => true),
  commitNoEdit: mock(async () => true),
  commitWithMessage: commitWithMessageMock,
  continueRebase: mock(async () => true),
  dryRunPushCurrentBranch: dryRunPushMock,
  ensureRemote: mock(async () => 'unchanged'),
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: fetchRemoteMock,
  getAheadBehind: mock(async () => ({ ahead: 0, behind: 0 })),
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: getCurrentBranchMock,
  getHeadCommit: getHeadCommitMock,
  getPorcelainStatus: getPorcelainStatusMock,
  getSubmoduleCommitsInMainRange: getSubmoduleCommitsInMainRangeMock,
  hasLocalCommitsOnOrigin: mock(async () => false),
  hasSubmodulePointerChange: hasSubmodulePointerChangeMock,
  isCommitOnHead: isCommitOnHeadMock,
  isCommitPushed: isCommitPushedMock,
  isSubmoduleCommitOnHead: isSubmoduleCommitOnHeadMock,
  isSubmoduleCommitPushed: isSubmoduleCommitPushedMock,
  getRemoteBranchRef: mock(async () => 'abc123'),
  getRemoteUrl: getRemoteUrlMock,
  initGitRepo: mock(async () => true),
  initSubmodules: mock(async () => true),
  isGitRepo: mock(async () => true),
  isGitRepoRoot: isGitRepoRootMock,
  isShallowRepo: isShallowRepoMock,
  listLocalBranches: mock(async () => []),
  listRemoteBranches: mock(async () => ['main']),
  mergeRef: mock(async () => true),
  pushCurrentBranch: pushCurrentBranchMock,
  rebaseOnto: mock(async () => true),
  removeRemote: mock(async () => {}),
  stagePaths: stagePathsMock,
  unstagePaths: unstagePathsMock,
  unshallowRepo: mock(async () => true),
}))

mock.module('../src/commands/repo/internal/github-token.ts', () => ({
  resolveGitHubToken: resolveGitHubTokenMock,
}))

const { repoPushAction } = await import('../src/commands/repo/push.ts')

function makeProject(): string {
  const projectDir = join(tmpdir(), `fba-repo-push-command-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(projectDir, 'backend'), { recursive: true })
  mkdirSync(join(projectDir, 'frontend'), { recursive: true })
  writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
    name: 'demo',
    backend_name: 'backend',
    frontend_name: 'frontend',
  }), 'utf-8')
  writeFileSync(join(projectDir, '.gitmodules'), [
    '[submodule "backend"]',
    '  path = backend',
    '  url = https://github.com/acme/repo.git',
    '[submodule "frontend"]',
    '  path = frontend',
    '  url = https://github.com/acme/repo.git',
    '',
  ].join('\n'), 'utf-8')
  return projectDir
}

describe('repo push command flow', () => {
  const dirs: string[] = []
  const originalConsoleLog = console.log

  beforeEach(() => {
    console.log = consoleLogMock as unknown as typeof console.log
    consoleLogMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockImplementation(async () => false)
    multiselectMock.mockReset()
    multiselectMock.mockImplementation(async () => ['backend', 'frontend', 'main'])
    stagePathsMock.mockReset()
    stagePathsMock.mockImplementation(async () => true)
    commitWithMessageMock.mockReset()
    commitWithMessageMock.mockImplementation(async () => true)
    unstagePathsMock.mockReset()
    unstagePathsMock.mockImplementation(async () => true)
    dryRunPushMock.mockReset()
    dryRunPushMock.mockImplementation(async () => true)
    getPorcelainStatusMock.mockReset()
    getPorcelainStatusMock.mockImplementation(async () => [])
    getSubmoduleCommitsInMainRangeMock.mockReset()
    getSubmoduleCommitsInMainRangeMock.mockImplementation(async () => ({
      backend: ['backend-commit'],
      frontend: ['frontend-commit'],
    }))
    hasSubmodulePointerChangeMock.mockReset()
    hasSubmodulePointerChangeMock.mockImplementation(async () => false)
    getHeadCommitMock.mockReset()
    getHeadCommitMock.mockImplementation(async () => 'child-head')
    isCommitOnHeadMock.mockReset()
    isCommitOnHeadMock.mockImplementation(async () => true)
    isCommitPushedMock.mockReset()
    isCommitPushedMock.mockImplementation(async () => true)
    isSubmoduleCommitOnHeadMock.mockReset()
    isSubmoduleCommitOnHeadMock.mockImplementation(async () => true)
    isSubmoduleCommitPushedMock.mockReset()
    isSubmoduleCommitPushedMock.mockImplementation(async () => true)
    fetchRemoteMock.mockReset()
    fetchRemoteMock.mockImplementation(async () => true)
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
    isShallowRepoMock.mockReset()
    isShallowRepoMock.mockImplementation(async () => false)
    pushCurrentBranchMock.mockReset()
    pushCurrentBranchMock.mockImplementation(async () => true)
    resolveGitHubTokenMock.mockReset()
    resolveGitHubTokenMock.mockImplementation(async () => null)
    cancelMock.mockClear()
  })

  afterEach(() => {
    console.log = originalConsoleLog
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('does not dry-run push before the target project is confirmed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)

    await repoPushAction({ projectDir })

    expect(confirmMock).toHaveBeenCalled()
    expect(dryRunPushMock).not.toHaveBeenCalled()
  })

  test('does not push after dry-run unless the user confirms publishing', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await repoPushAction({ projectDir })

    expect(dryRunPushMock).toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('lets the user push only the main repository', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(dryRunPushMock).toHaveBeenCalledTimes(1)
    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledTimes(1)
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('redacts embedded credentials from the final push confirmation', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    writeFileSync(join(projectDir, '.gitmodules'), [
      '[submodule "backend"]',
      '  path = backend',
      '  url = https://ghp_secret@github.com/acme/repo.git',
      '[submodule "frontend"]',
      '  path = frontend',
      '  url = https://ghp_secret@github.com/acme/repo.git',
      '',
    ].join('\n'), 'utf-8')
    getRemoteUrlMock.mockImplementation(async (_dir: string, name: string) => (
      name === 'origin'
        ? 'https://ghp_secret@github.com/acme/repo.git'
        : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await repoPushAction({ projectDir })

    const finalConfirmation = confirmMock.mock.calls.at(-1)?.[0] as { message?: string } | undefined
    expect(finalConfirmation?.message).toContain('https://***@github.com/acme/repo.git')
    expect(finalConfirmation?.message).not.toContain('ghp_secret')
  })

  test('blocks main push when unselected child origin refs cannot be refreshed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    fetchRemoteMock.mockImplementation(async (dir: string) => !dir.endsWith('backend'))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(isSubmoduleCommitPushedMock).not.toHaveBeenCalledWith(projectDir, 'backend')
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('blocks main push when main origin refs cannot be refreshed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    fetchRemoteMock.mockImplementation(async (dir: string) => dir !== projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(getSubmoduleCommitsInMainRangeMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('offers to commit main repository submodule pointer changes when affected children are selected', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async (_projectDir: string, path: string) => path !== 'backend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['backend', 'main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: update submodule refs')
    expect(dryRunPushMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('does not offer to commit main pointers for dirty-only child worktrees', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockResolvedValue(false)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('does not offer to commit main repository pointer changes when main is not selected', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['backend'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
  })

  test('does not create a pointer commit when selected push prechecks fail', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (dir === join(projectDir, 'backend') && name === 'origin') return null
      return name === 'origin'
        ? 'https://github.com/acme/repo.git'
        : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
    })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(multiselectMock).toHaveBeenCalled()
    expect(dryRunPushMock).not.toHaveBeenCalled()
  })

  test('lets the user push main when an unselected child repository is dirty', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === join(projectDir, 'backend') ? [' M app.py'] : []
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(dryRunPushMock).toHaveBeenCalledTimes(1)
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('skips main pointer commit when unselected child commits are not on origin', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => {
      if (dir === projectDir) return [' M backend']
      if (dir === join(projectDir, 'backend')) return [' M app.py']
      return []
    })
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async (_projectDir: string, path: string, commit: string) => (
      !(path === 'backend' && commit === 'child-head')
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('allows pointer commit for unselected child commits that are already on origin', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async () => true)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(fetchRemoteMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(getHeadCommitMock).toHaveBeenCalledWith(join(projectDir, 'backend'))
    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'backend', 'child-head')
    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: update submodule refs')
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('does not block skipped working-tree pointer changes on stale committed gitlinks', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async () => true)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'backend', 'child-head')
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('blocks when a selected child repository is dirty', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === join(projectDir, 'backend') ? [' M app.py'] : []
    ))
    confirmMock.mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['backend'])

    await repoPushAction({ projectDir })

    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('continues when the user skips committing main repository pointer changes', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async () => true)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('cancels when pointer commit confirmation is cancelled', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async () => true)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(cancelSymbol)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(cancelMock).toHaveBeenCalled()
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(commitWithMessageMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('unstages main pointer changes when the local pointer commit fails', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getPorcelainStatusMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? [' M backend'] : []
    ))
    hasSubmodulePointerChangeMock.mockImplementation(async (_dir: string, path: string) => path === 'backend')
    isCommitPushedMock.mockImplementation(async () => true)
    commitWithMessageMock.mockResolvedValueOnce(false)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(stagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(commitWithMessageMock).toHaveBeenCalledWith(projectDir, 'chore: update submodule refs')
    expect(unstagePathsMock).toHaveBeenCalledWith(projectDir, ['backend'])
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('blocks main push when main references child commits that are not selected or already on origin', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    isCommitPushedMock.mockImplementation(async (_projectDir: string, path: string) => path !== 'backend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(getSubmoduleCommitsInMainRangeMock).toHaveBeenCalledWith(
      projectDir,
      'main',
      ['backend', 'frontend'],
    )
    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'backend', 'backend-commit')
    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'frontend', 'frontend-commit')
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('blocks main push when child commit availability cannot be verified', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    isCommitPushedMock.mockImplementation(async (_projectDir: string, path: string) => (
      path === 'backend' ? null : true
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'backend', 'backend-commit')
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('allows main push when referenced child commits are selected for the same push', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    isCommitPushedMock.mockImplementation(async (_projectDir: string, path: string) => path !== 'backend')
    isCommitOnHeadMock.mockImplementation(async (_projectDir: string, path: string) => path === 'backend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['backend', 'main'])

    await repoPushAction({ projectDir })

    expect(isCommitOnHeadMock).toHaveBeenCalledWith(projectDir, 'backend', 'backend-commit')
    expect(dryRunPushMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
    expect(dryRunPushMock).toHaveBeenCalledWith(projectDir, 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(join(projectDir, 'backend'), 'main')
    expect(pushCurrentBranchMock).toHaveBeenCalledWith(projectDir, 'main')
  })

  test('blocks main push when selected child HEAD does not contain the referenced gitlink commit', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    isCommitOnHeadMock.mockImplementation(async (_projectDir: string, path: string) => (
      path === 'backend' ? false : true
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['backend', 'main'])

    await repoPushAction({ projectDir })

    expect(isCommitOnHeadMock).toHaveBeenCalledWith(projectDir, 'backend', 'backend-commit')
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('blocks main push when an older outgoing main commit references an unpublished child commit', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getSubmoduleCommitsInMainRangeMock.mockImplementation(async () => ({
      backend: ['unpushed-old-commit', 'published-head-commit'],
      frontend: ['frontend-commit'],
    }))
    isCommitPushedMock.mockImplementation(async (_projectDir: string, _path: string, commit: string) => (
      commit !== 'unpushed-old-commit'
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    multiselectMock.mockResolvedValueOnce(['main'])

    await repoPushAction({ projectDir })

    expect(isCommitPushedMock).toHaveBeenCalledWith(projectDir, 'backend', 'unpushed-old-commit')
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })

  test('does not read inherited parent Git state for child directories that are not Git roots', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir === projectDir)

    await repoPushAction({ projectDir })

    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
    expect(getCurrentBranchMock).toHaveBeenCalledWith(projectDir)
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'))
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'))
    expect(multiselectMock).toHaveBeenCalledWith(expect.objectContaining({
      options: [expect.objectContaining({ value: 'main' })],
    }))
  })

  test('handles unreadable gitmodules without crashing', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    rmSync(join(projectDir, '.gitmodules'), { force: true })
    mkdirSync(join(projectDir, '.gitmodules'))
    confirmMock.mockResolvedValueOnce(true)

    await expect(repoPushAction({ projectDir })).resolves.toBeUndefined()

    expect(consoleLogMock.mock.calls.flat().join('\n')).toContain('Unable to read')
    expect(multiselectMock).not.toHaveBeenCalled()
    expect(dryRunPushMock).not.toHaveBeenCalled()
    expect(pushCurrentBranchMock).not.toHaveBeenCalled()
  })
})
