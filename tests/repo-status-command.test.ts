import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const isGitRepoMock = mock(async () => true)

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  cancel: mock(() => {}),
  outro: mock(() => {}),
  note: mock(() => {}),
  select: mock(async () => 'exit'),
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
  checkoutConflictSide: mock(async () => true),
  cloneRepository: mock(async () => true),
  commitNoEdit: mock(async () => true),
  commitWithMessage: mock(async () => true),
  continueRebase: mock(async () => true),
  dryRunPushCurrentBranch: mock(async () => true),
  ensureRemote: mock(async () => 'unchanged'),
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: mock(async () => true),
  getAheadBehind: mock(async () => ({ ahead: 0, behind: 0 })),
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: mock(async () => 'main'),
  getPorcelainStatus: mock(async () => []),
  getRemoteBranchRef: mock(async () => 'abc123'),
  getRemoteUrl: mock(async (_dir: string, name: string) => (
    name === 'origin'
      ? 'https://github.com/acme/repo.git'
      : 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
  )),
  initGitRepo: mock(async () => true),
  isGitRepo: isGitRepoMock,
  isGitRepoRoot: mock(async () => true),
  isShallowRepo: mock(async () => false),
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
  return projectDir
}

describe('repo status command flow', () => {
  const dirs: string[] = []

  beforeEach(() => {
    confirmMock.mockReset()
    confirmMock.mockImplementation(async () => false)
    isGitRepoMock.mockReset()
    isGitRepoMock.mockImplementation(async () => true)
  })

  afterEach(() => {
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
})
