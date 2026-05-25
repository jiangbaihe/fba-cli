import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const selectMock = mock(async () => 'exit')
const isGitRepoMock = mock(async () => true)
const isGitRepoRootMock = mock(async () => true)
const getCurrentBranchMock = mock(async () => 'main')
const getRemoteUrlMock = mock(async (dir: string, name: string) => {
  if (name === 'origin') return 'https://github.com/acme/repo.git'
  if (dir.endsWith('frontend')) return 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git'
  return 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
})
const consoleLogMock = mock(() => {})

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  cancel: mock(() => {}),
  outro: mock(() => {}),
  note: mock(() => {}),
  select: selectMock,
  confirm: confirmMock,
  isCancel: mock(() => false),
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
  commitWithMessage: mock(async () => true),
  continueRebase: mock(async () => true),
  deinitSubmodules: mock(async () => true),
  dryRunPushCurrentBranch: mock(async () => true),
  ensureRemote: mock(async () => 'unchanged'),
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: mock(async () => true),
  getAheadBehind: mock(async () => ({ ahead: 0, behind: 0 })),
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: getCurrentBranchMock,
  getPorcelainStatus: mock(async () => []),
  hasLocalCommitsOnOrigin: mock(async () => false),
  hasSubmodulePointerChange: mock(async () => false),
  isSubmoduleCommitOnHead: mock(async () => true),
  isSubmoduleCommitPushed: mock(async () => true),
  getRemoteBranchRef: mock(async () => 'abc123'),
  getRemoteUrl: getRemoteUrlMock,
  initSubmodules: mock(async () => true),
  initGitRepo: mock(async () => true),
  isGitRepo: isGitRepoMock,
  isGitRepoRoot: isGitRepoRootMock,
  isShallowRepo: mock(async () => false),
  listLocalBranches: mock(async () => []),
  listRemoteBranches: mock(async () => ['main']),
  mergeRef: mock(async () => true),
  pushCurrentBranch: mock(async () => true),
  rebaseOnto: mock(async () => true),
  removeRemote: mock(async () => {}),
  stagePaths: mock(async () => true),
  unshallowRepo: mock(async () => true),
}))

const { repoStatusAction } = await import('../src/commands/repo/status.ts')

function makeProject(): string {
  const projectDir = join(tmpdir(), `fba-repo-status-command-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

describe('repo status command flow', () => {
  const dirs: string[] = []
  const originalConsoleLog = console.log

  beforeEach(() => {
    console.log = consoleLogMock as unknown as typeof console.log
    consoleLogMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockImplementation(async () => false)
    selectMock.mockReset()
    selectMock.mockImplementation(async () => 'exit')
    isGitRepoMock.mockReset()
    isGitRepoMock.mockImplementation(async () => true)
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    getCurrentBranchMock.mockReset()
    getCurrentBranchMock.mockImplementation(async () => 'main')
    getRemoteUrlMock.mockReset()
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (name === 'origin') return 'https://github.com/acme/repo.git'
      if (dir.endsWith('frontend')) return 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git'
      return 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
    })
  })

  afterEach(() => {
    console.log = originalConsoleLog
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('does not inspect repositories before the target project is confirmed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)

    await repoStatusAction({ projectDir })

    expect(confirmMock).toHaveBeenCalled()
    expect(isGitRepoMock).not.toHaveBeenCalled()
  })

  test('checks current branch so detached child repositories are visible in status', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend') ? null : 'main'
    ))

    await repoStatusAction({ projectDir })

    expect(getCurrentBranchMock).toHaveBeenCalledWith(join(projectDir, 'backend'))
    expect(getCurrentBranchMock).toHaveBeenCalledWith(join(projectDir, 'frontend'))
  })

  test('does not suggest repo init when warnings are not init-repairable', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? null : 'main'
    ))

    await repoStatusAction({ projectDir })

    const output = consoleLogMock.mock.calls.flat().join('\n')
    expect(output).not.toContain('fba-cli repo init')
    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'exit',
    }))
  })

  test('does not suggest repo init for non-empty child directories that are not Git roots', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'backend', 'user-file.txt'), 'keep me', 'utf-8')
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir !== join(projectDir, 'backend')
    ))

    await repoStatusAction({ projectDir })

    const output = consoleLogMock.mock.calls.flat().join('\n')
    expect(output).not.toContain('fba-cli repo init')
    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: 'exit',
    }))
  })

  test('does not read inherited parent Git state for child directories that are not Git roots', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir === projectDir)

    await repoStatusAction({ projectDir })

    expect(getRemoteUrlMock).toHaveBeenCalledWith(projectDir, 'origin')
    expect(isGitRepoMock).not.toHaveBeenCalled()
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'), 'origin')
    expect(getRemoteUrlMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'), 'origin')
    expect(getCurrentBranchMock).toHaveBeenCalledWith(projectDir)
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'backend'))
    expect(getCurrentBranchMock).not.toHaveBeenCalledWith(join(projectDir, 'frontend'))
  })

  test('still reports when the main project directory is inside another Git repository', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => dir !== projectDir)

    await repoStatusAction({ projectDir })

    const output = consoleLogMock.mock.calls.flat().join('\n')
    expect(isGitRepoMock).toHaveBeenCalledWith(projectDir)
    expect(output).toContain('主仓 位于另一个 Git 仓库内部')
  })

  test('handles unreadable gitmodules without crashing', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    rmSync(join(projectDir, '.gitmodules'), { force: true })
    mkdirSync(join(projectDir, '.gitmodules'))
    confirmMock.mockResolvedValueOnce(true)

    await expect(repoStatusAction({ projectDir })).resolves.toBeUndefined()

    expect(consoleLogMock.mock.calls.flat().join('\n')).toContain('Unable to read')
    expect(selectMock).not.toHaveBeenCalled()
  })
})
