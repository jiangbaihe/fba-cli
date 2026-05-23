import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const confirmMock = mock(async () => false)
const textMock = mock(async () => 'octo')
const runMock = mock(async () => ({ stdout: 'git version 2.0.0\n', stderr: '', exitCode: 0 }))
const resolveGitHubTokenMock = mock(async () => ({ source: 'GITHUB_TOKEN', token: 'token' }))
const cancelMock = mock(() => {})
let getRepositoryError: Error | null = null
const createGitHubClientMock = mock((token: string, fetcher?: (path: string, options: Record<string, unknown>) => Promise<any>) => {
  const request = <T>(path: string, options: Record<string, unknown> = {}) => {
    if (!fetcher) {
      if (path === '/user') return Promise.resolve({ login: 'octo' } as T)
      if (String(path).startsWith('/repos/')) return Promise.resolve(null as T)
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
const isGitRepoRootMock = mock(async () => true)

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
  checkoutConflictSide: mock(async () => true),
  cloneRepository: mock(async () => true),
  commitNoEdit: mock(async () => true),
  commitWithMessage: mock(async () => true),
  continueRebase: mock(async () => true),
  dryRunPushCurrentBranch: mock(async () => true),
  ensureRemote: ensureRemoteMock,
  fastForwardFromOrigin: mock(async () => true),
  fetchOrigin: mock(async () => true),
  fetchRemote: mock(async () => true),
  getAheadBehind: mock(async () => ({ ahead: 0, behind: 0 })),
  getConflictedPaths: mock(async () => []),
  getCurrentBranch: mock(async () => 'main'),
  getRemoteUrl: mock(async () => null),
  getPorcelainStatus: mock(async () => []),
  getRemoteBranchRef: mock(async () => 'abc123'),
  initGitRepo: mock(async () => true),
  isGitRepo: mock(async () => true),
  isGitRepoRoot: isGitRepoRootMock,
  isShallowRepo: mock(async () => false),
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
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
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

  test('does not access GitHub when a child directory is not a Git repository root', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    confirmMock.mockResolvedValueOnce(true)
    isGitRepoRootMock.mockImplementation(async (dir: string) => !dir.endsWith('backend'))

    const completed = await repoInitAction({ projectDir })

    expect(completed).toBe(false)
    expect(resolveGitHubTokenMock).not.toHaveBeenCalled()
    expect(createGitHubClientMock).not.toHaveBeenCalled()
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
})
