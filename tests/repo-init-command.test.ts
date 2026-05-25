import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const textMock = mock(async () => 'octo')
const runMock = mock(async () => ({ stdout: 'git version 2.0.0\n', stderr: '', exitCode: 0 }))
const resolveGitHubTokenMock = mock(async () => ({ source: 'GITHUB_TOKEN', token: 'token' }))
const cancelMock = mock(() => {})
let getRepositoryError: Error | null = null
const existingRepositories = new Set<string>()
const createGitHubClientMock = mock((token: string, fetcher?: (path: string, options: Record<string, unknown>) => Promise<any>) => {
  const request = <T>(path: string, options: Record<string, unknown> = {}) => {
    if (!fetcher) {
      if (path === '/user') return Promise.resolve({ login: 'octo' } as T)
      if (String(path).startsWith('/repos/')) {
        const [, , owner, repo] = String(path).split('/')
        const fullName = `${decodeURIComponent(owner ?? '')}/${decodeURIComponent(repo ?? '')}`
        return Promise.resolve(existingRepositories.has(fullName)
          ? {
            full_name: fullName,
            clone_url: `https://github.com/${fullName}.git`,
          } as T
          : null as T)
      }
      return Promise.resolve({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' } as T)
    }

    return fetcher(path, {
      baseURL: 'https://api.github.com',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...options,
    })
  }

  return {
    getAuthenticatedUser: () => request<{ login: string }>('/user', { method: 'GET' }),
    async getRepository(owner: string, repo: string) {
      if (getRepositoryError) throw getRepositoryError
      try {
        return await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: 'GET' })
      } catch (error) {
        const maybeError = error as { status?: number; response?: { status?: number } }
        if (maybeError.status === 404 || maybeError.response?.status === 404) return null
        throw error
      }
    },
    createRepository: (input: { owner: string; name: string; private: boolean; authenticatedUser: string }) => {
      const path = input.owner === input.authenticatedUser
        ? '/user/repos'
        : `/orgs/${encodeURIComponent(input.owner)}/repos`
      return request(path, {
        method: 'POST',
        body: {
          name: input.name,
          private: input.private,
        },
      })
    },
  }
})
const ensureRemoteMock = mock(async () => 'unchanged')
const initSubmodulesMock = mock(async () => true)
const getMissingSubmoduleGitlinkPathsMock = mock(async () => [])
const isGitRepoRootMock = mock(async () => true)
const getRemoteUrlMock = mock(async () => null)
const getCurrentBranchMock = mock(async () => 'main')

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  cancel: cancelMock,
  outro: mock(() => {}),
  note: mock(() => {}),
  password: mock(async () => 'token'),
  select: mock(async () => 'public'),
  text: textMock,
  confirm: confirmMock,
  isCancel: mock(() => false),
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
    step: mock(() => {}),
    warn: mock(() => {}),
  },
}))

mock.module('../src/commands/repo/internal/process.ts', () => ({
  run: runMock,
}))

mock.module('../src/commands/repo/internal/github-token.ts', () => ({
  resolveGitHubToken: resolveGitHubTokenMock,
}))

mock.module('../src/commands/repo/internal/github.ts', () => ({
  createGitHubClient: createGitHubClientMock,
  parseGitHubHttpsUrl: mock((url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null
    const [owner, repoWithSuffix] = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
    const repo = repoWithSuffix?.replace(/\.git$/i, '')
    return owner && repo && parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').length === 2 ? {
      owner,
      repo,
      normalizedUrl: `https://github.com/${owner}/${repo}.git`,
    } : null
  }),
}))

mock.module('../src/commands/repo/internal/git.ts', () => ({
  abortMerge: mock(async () => true),
  abortRebase: mock(async () => true),
  checkoutBranch: mock(async () => true),
  checkoutDetached: mock(async () => true),
  checkoutExistingBranch: mock(async () => true),
  checkoutNewBranchAtHead: mock(async () => true),
  checkoutConflictSide: mock(async () => true),
  cloneRepository: mock(async () => true),
  commitNoEdit: mock(async () => true),
  commitWithMessage: mock(async () => true),
  continueRebase: mock(async () => true),
  deleteLocalBranch: mock(async () => true),
  deinitSubmodules: mock(async () => true),
  dryRunPushCurrentBranch: mock(async () => true),
  ensureRemote: ensureRemoteMock,
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: mock(async () => true),
  getAheadBehind: mock(async () => ({ ahead: 0, behind: 0 })),
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: getCurrentBranchMock,
  getHeadCommit: mock(async () => 'HEAD'),
  getRemoteUrl: getRemoteUrlMock,
  getPorcelainStatus: mock(async () => []),
  hasLocalCommitsOnOrigin: mock(async () => false),
  hasSubmodulePointerChange: mock(async () => false),
  isSubmoduleCommitOnHead: mock(async () => true),
  isSubmoduleCommitPushed: mock(async () => true),
  getRemoteBranchRef: mock(async () => 'abc123'),
  getMissingSubmoduleGitlinkPaths: getMissingSubmoduleGitlinkPathsMock,
  initSubmodules: initSubmodulesMock,
  initGitRepo: mock(async () => true),
  isGitRepo: mock(async () => true),
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

const { repoInitAction } = await import('../src/commands/repo/init.ts')

function makeProject(): string {
  const projectDir = join(tmpdir(), `fba-repo-init-command-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(projectDir, 'backend'), { recursive: true })
  mkdirSync(join(projectDir, 'frontend'), { recursive: true })
  writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
    name: 'demo',
    backend_name: 'backend',
    frontend_name: 'frontend',
  }), 'utf-8')
  return projectDir
}

function makeProjectWithoutChildren(): string {
  const projectDir = join(tmpdir(), `fba-repo-init-command-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
    name: 'demo',
    backend_name: 'backend',
    frontend_name: 'frontend',
  }), 'utf-8')
  return projectDir
}

function makeProjectWithEmptyChildren(): string {
  const projectDir = makeProjectWithoutChildren()
  mkdirSync(join(projectDir, 'backend'), { recursive: true })
  mkdirSync(join(projectDir, 'frontend'), { recursive: true })
  return projectDir
}

function markExistingRepositories(...repos: string[]): void {
  for (const repo of repos) existingRepositories.add(repo)
}

describe('repo init command flow', () => {
  const dirs: string[] = []

  beforeEach(() => {
    confirmMock.mockReset()
    confirmMock.mockImplementation(async () => false)
    textMock.mockReset()
    textMock.mockImplementation(async () => 'octo')
    runMock.mockReset()
    runMock.mockImplementation(async () => ({ stdout: 'git version 2.0.0\n', stderr: '', exitCode: 0 }))
    resolveGitHubTokenMock.mockReset()
    resolveGitHubTokenMock.mockImplementation(async () => ({ source: 'GITHUB_TOKEN', token: 'token' }))
    cancelMock.mockClear()
    createGitHubClientMock.mockClear()
    ensureRemoteMock.mockReset()
    ensureRemoteMock.mockImplementation(async () => 'unchanged')
    getRemoteUrlMock.mockReset()
    getRemoteUrlMock.mockImplementation(async () => null)
    getCurrentBranchMock.mockReset()
    getCurrentBranchMock.mockImplementation(async () => 'main')
    initSubmodulesMock.mockReset()
    initSubmodulesMock.mockImplementation(async () => true)
    getMissingSubmoduleGitlinkPathsMock.mockReset()
    getMissingSubmoduleGitlinkPathsMock.mockImplementation(async () => [])
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    existingRepositories.clear()
    getRepositoryError = null
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('does not access GitHub or mutate remotes before the target project is confirmed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)

    const completed = await repoInitAction({ projectDir })

    expect(confirmMock).toHaveBeenCalled()
    expect(completed).toBe(false)
    expect(cancelMock).toHaveBeenCalled()
    expect(resolveGitHubTokenMock).not.toHaveBeenCalled()
    expect(createGitHubClientMock).not.toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('confirms the target project before local repo preflight checks', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)

    const completed = await repoInitAction({ projectDir })

    expect(confirmMock).toHaveBeenCalled()
    expect(completed).toBe(false)
    expect(runMock).not.toHaveBeenCalled()
    expect(resolveGitHubTokenMock).not.toHaveBeenCalled()
  })

  test('does not initialize invalid child directories before the final apply confirmation', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    isGitRepoRootMock.mockImplementation(async (dir: string) => !dir.endsWith('backend'))

    const completed = await repoInitAction({ projectDir })

    expect(completed).toBe(false)
    expect(resolveGitHubTokenMock).toHaveBeenCalled()
    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('handles GitHub repository lookup failures without crashing the wizard', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getRepositoryError = new Error('network down')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('handles local apply failures after rollback without crashing the wizard', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    ensureRemoteMock.mockRejectedValueOnce(new Error('remote update failed'))

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(ensureRemoteMock).toHaveBeenCalled()
  })

  test('handles snapshot read failures without accessing GitHub', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    rmSync(join(projectDir, '.gitmodules'), { force: true })
    mkdirSync(join(projectDir, '.gitmodules'))
    confirmMock.mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(createGitHubClientMock).not.toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('initializes missing child submodules after the remote plan is confirmed', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    let planConfirmed = false
    initSubmodulesMock.mockImplementationOnce(async (dir: string, paths: string[]) => {
      expect(planConfirmed).toBe(true)
      for (const path of paths) mkdirSync(join(dir, path), { recursive: true })
      return true
    })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        planConfirmed = true
        return true
      })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(initSubmodulesMock).toHaveBeenCalledWith(projectDir, ['backend', 'frontend'], { authToken: 'token' })
    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).toHaveBeenCalled()
  })

  test('does not initialize missing child submodules when the main HEAD has no gitlink', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    getMissingSubmoduleGitlinkPathsMock.mockResolvedValueOnce(['backend'])
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(getMissingSubmoduleGitlinkPathsMock).toHaveBeenCalledWith(projectDir, ['backend', 'frontend'])
    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('initializes empty child submodule directories after the remote plan is confirmed', async () => {
    const projectDir = makeProjectWithEmptyChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    let planConfirmed = false
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir === join(projectDir, 'backend') || dir === join(projectDir, 'frontend')
        ? false
        : true
    ))
    initSubmodulesMock.mockImplementationOnce(async () => {
      expect(planConfirmed).toBe(true)
      isGitRepoRootMock.mockImplementation(async () => true)
      return true
    })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        planConfirmed = true
        return true
      })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(initSubmodulesMock).toHaveBeenCalledWith(projectDir, ['backend', 'frontend'], { authToken: 'token' })
    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).toHaveBeenCalled()
  })

  test('does not mutate remotes when missing child submodule initialization is declined', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(resolveGitHubTokenMock).toHaveBeenCalled()
    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('does not initialize missing child submodules from newly-created empty child repositories', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/demo')
    const prompts = await import('@clack/prompts')
    const selectMock = prompts.select as unknown as ReturnType<typeof mock>
    selectMock.mockClear()
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, 'backend'))).toBe(false)
    expect(existsSync(join(projectDir, 'frontend'))).toBe(false)
    expect(ensureRemoteMock).not.toHaveBeenCalled()
    expect(selectMock).not.toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(3)
  })

  test('does not initialize empty child directories from newly-created empty child repositories', async () => {
    const projectDir = makeProjectWithEmptyChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/demo')
    const prompts = await import('@clack/prompts')
    const selectMock = prompts.select as unknown as ReturnType<typeof mock>
    selectMock.mockClear()
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir === projectDir
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, 'backend'))).toBe(true)
    expect(existsSync(join(projectDir, 'frontend'))).toBe(true)
    expect(ensureRemoteMock).not.toHaveBeenCalled()
    expect(selectMock).not.toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(3)
  })

  test('does not initialize non-empty child directories that are not Git roots', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'backend', 'user-file.txt'), 'keep me', 'utf-8')
    markExistingRepositories('octo/demo', 'octo/backend', 'octo/frontend')
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir !== join(projectDir, 'backend')
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, 'backend', 'user-file.txt'))).toBe(true)
  })

  test('rolls back child directories created by failed missing child initialization', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    initSubmodulesMock.mockImplementationOnce(async (dir: string) => {
      mkdirSync(join(dir, 'backend'), { recursive: true })
      return false
    })
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(existsSync(join(projectDir, 'backend'))).toBe(false)
    expect(resolveGitHubTokenMock).toHaveBeenCalled()
    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('rolls back when writing gitmodules before missing child initialization fails', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        mkdirSync(join(projectDir, '.gitmodules'))
        return true
      })

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, 'backend'))).toBe(false)
    expect(existsSync(join(projectDir, 'frontend'))).toBe(false)
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('does not mutate remotes when the final apply confirmation is declined', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(ensureRemoteMock).not.toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  test('does not initialize missing child submodules when the final apply confirmation is declined', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, 'backend'))).toBe(false)
    expect(existsSync(join(projectDir, 'frontend'))).toBe(false)
    expect(ensureRemoteMock).not.toHaveBeenCalled()
  })

  test('rolls back initialized child submodules when later apply fails', async () => {
    const projectDir = makeProjectWithoutChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    initSubmodulesMock.mockImplementationOnce(async (dir: string, paths: string[]) => {
      for (const path of paths) mkdirSync(join(dir, path), { recursive: true })
      return true
    })
    ensureRemoteMock.mockRejectedValueOnce(new Error('remote update failed'))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(false)

    expect(initSubmodulesMock).toHaveBeenCalledWith(projectDir, ['backend', 'frontend'], { authToken: 'token' })
    expect(existsSync(join(projectDir, 'backend'))).toBe(false)
    expect(existsSync(join(projectDir, 'frontend'))).toBe(false)
    expect(ensureRemoteMock).toHaveBeenCalled()
  })

  test('returns true when repository initialization completes', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(createGitHubClientMock).toHaveBeenCalled()
    expect(ensureRemoteMock).toHaveBeenCalled()
  })

  test('uses prompt defaults when the GitHub owner prompt is submitted empty', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    textMock.mockResolvedValueOnce('')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://github.com/octo/demo.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'backend'),
      'origin',
      'https://github.com/octo/backend.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'frontend'),
      'origin',
      'https://github.com/octo/frontend.git',
    )
  })

  test('lets the user re-enter remote URLs when manual remotes point to the same GitHub repository', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    markExistingRepositories('octo/demo', 'octo/backend', 'octo/frontend')
    textMock
      .mockResolvedValueOnce('octo')
      .mockResolvedValueOnce('https://github.com/octo/demo.git')
      .mockResolvedValueOnce('https://github.com/octo/demo.git')
      .mockResolvedValueOnce('https://github.com/octo/frontend.git')
      .mockResolvedValueOnce('https://github.com/octo/demo.git')
      .mockResolvedValueOnce('https://github.com/octo/backend.git')
      .mockResolvedValueOnce('https://github.com/octo/frontend.git')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(textMock).toHaveBeenCalledTimes(7)
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'backend'),
      'origin',
      'https://github.com/octo/backend.git',
    )
  })

  test('trims a token entered in the prompt before creating the GitHub client', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    resolveGitHubTokenMock.mockResolvedValueOnce(null)
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const prompts = await import('@clack/prompts')
    const passwordMock = prompts.password as unknown as ReturnType<typeof mock>
    passwordMock.mockResolvedValueOnce(' token-from-prompt ')

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(createGitHubClientMock).toHaveBeenCalledWith('token-from-prompt')
  })

  test('prefers existing local remote URLs as init defaults for cloned projects', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (name !== 'origin') return null
      if (dir === projectDir) return 'https://github.com/org/existing-main.git'
      if (dir === join(projectDir, 'backend')) return 'https://github.com/org/existing-backend.git'
      if (dir === join(projectDir, 'frontend')) return 'https://github.com/org/existing-frontend.git'
      return null
    })
    textMock.mockResolvedValueOnce('')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://github.com/org/existing-main.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'backend'),
      'origin',
      'https://github.com/org/existing-backend.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'frontend'),
      'origin',
      'https://github.com/org/existing-frontend.git',
    )
  })

  test('ignores parent repository remotes when child directories are not Git roots', async () => {
    const projectDir = makeProjectWithEmptyChildren()
    dirs.push(projectDir)
    markExistingRepositories('octo/backend', 'octo/frontend')
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir === projectDir
    ))
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (name !== 'origin') return null
      if (dir === projectDir) return 'https://github.com/org/existing-main.git'
      if (dir === join(projectDir, 'backend')) return 'https://github.com/org/existing-main.git'
      if (dir === join(projectDir, 'frontend')) return 'https://github.com/org/existing-main.git'
      return null
    })
    initSubmodulesMock.mockImplementationOnce(async () => {
      isGitRepoRootMock.mockImplementation(async () => true)
      return true
    })
    textMock.mockResolvedValueOnce('')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://github.com/org/existing-main.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'backend'),
      'origin',
      'https://github.com/octo/backend.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'frontend'),
      'origin',
      'https://github.com/octo/frontend.git',
    )
  })

  test('ignores parent repository remotes when main project directory is not a Git root', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    isGitRepoRootMock.mockImplementation(async (dir: string) => (
      dir !== projectDir
    ))
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (name !== 'origin') return null
      if (dir === projectDir) return 'https://github.com/org/parent.git'
      if (dir === join(projectDir, 'backend')) return 'https://github.com/org/backend.git'
      if (dir === join(projectDir, 'frontend')) return 'https://github.com/org/frontend.git'
      return null
    })
    textMock.mockResolvedValueOnce('')
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(ensureRemoteMock).toHaveBeenCalledWith(
      projectDir,
      'origin',
      'https://github.com/octo/demo.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'backend'),
      'origin',
      'https://github.com/org/backend.git',
    )
    expect(ensureRemoteMock).toHaveBeenCalledWith(
      join(projectDir, 'frontend'),
      'origin',
      'https://github.com/org/frontend.git',
    )
  })

  test('skips the local init commit prompt when the main repository is detached', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === projectDir ? null : 'main'
    ))
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(repoInitAction({ projectDir })).resolves.toBe(true)

    expect(confirmMock).toHaveBeenCalledTimes(6)
    expect(runMock.mock.calls.some((call) => (
      call[0] === 'git' &&
      Array.isArray(call[1]) &&
      call[1][0] === 'commit'
    ))).toBe(false)
  })
})
