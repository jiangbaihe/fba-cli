import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ensureRemoteMock = mock(async () => 'unchanged')
const initGitRepoMock = mock(async () => true)
const isGitRepoRootMock = mock(async () => true)
const isShallowRepoMock = mock(async () => false)
const unshallowRepoMock = mock(async () => true)
const getRemoteUrlMock = mock(async () => null)
const removeRemoteMock = mock(async () => {})

mock.module('@clack/prompts', () => ({
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
  },
}))

mock.module('../src/commands/repo/internal/git.ts', () => ({
  ensureRemote: ensureRemoteMock,
  getRemoteUrl: getRemoteUrlMock,
  initGitRepo: initGitRepoMock,
  isGitRepoRoot: isGitRepoRootMock,
  removeRemote: removeRemoteMock,
  isShallowRepo: isShallowRepoMock,
  unshallowRepo: unshallowRepoMock,
}))

const {
  applyRepoInitPlan,
  checkChildRepositoryRoots,
} = await import('../src/commands/repo/internal/init-operations.ts')

function makeDirs(): { projectDir: string; backendDir: string; frontendDir: string } {
  const projectDir = join(tmpdir(), `fba-repo-init-operations-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const backendDir = join(projectDir, 'backend')
  const frontendDir = join(projectDir, 'frontend')
  mkdirSync(backendDir, { recursive: true })
  mkdirSync(frontendDir, { recursive: true })
  return { projectDir, backendDir, frontendDir }
}

function makePlan() {
  return {
    main: {
      role: 'main',
      action: 'create',
      private: false,
      ref: {
        owner: 'octo',
        repo: 'demo',
        normalizedUrl: 'https://github.com/octo/demo.git',
      },
    },
    backend: {
      role: 'backend',
      action: 'create',
      private: false,
      ref: {
        owner: 'octo',
        repo: 'backend',
        normalizedUrl: 'https://github.com/octo/backend.git',
      },
    },
    frontend: {
      role: 'frontend',
      action: 'create',
      private: false,
      ref: {
        owner: 'octo',
        repo: 'frontend',
        normalizedUrl: 'https://github.com/octo/frontend.git',
      },
    },
  } as const
}

describe('repo init apply operations', () => {
  const dirs: string[] = []

  beforeEach(() => {
    ensureRemoteMock.mockReset()
    ensureRemoteMock.mockImplementation(async () => 'unchanged')
    initGitRepoMock.mockReset()
    initGitRepoMock.mockImplementation(async () => true)
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    isShallowRepoMock.mockReset()
    isShallowRepoMock.mockImplementation(async () => false)
    unshallowRepoMock.mockReset()
    unshallowRepoMock.mockImplementation(async () => true)
    getRemoteUrlMock.mockReset()
    getRemoteUrlMock.mockImplementation(async () => null)
    removeRemoteMock.mockClear()
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  test('fetches full child history before creating GitHub repositories', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    const calls: string[] = []
    isShallowRepoMock.mockImplementation(async (dir: string) => {
      calls.push(`shallow:${dir.endsWith('backend') ? 'backend' : 'frontend'}`)
      return true
    })
    unshallowRepoMock.mockImplementation(async (dir: string) => {
      calls.push(`unshallow:${dir.endsWith('backend') ? 'backend' : 'frontend'}`)
      return true
    })
    createRepositoryMock.mockImplementation(async (input: { name: string }) => {
      calls.push(`create:${input.name}`)
      return { full_name: `octo/${input.name}`, clone_url: `https://github.com/octo/${input.name}.git` }
    })

    await applyRepoInitPlan({
      projectDir,
      backendDir,
      frontendDir,
      config: { name: 'demo', backend_name: 'backend', frontend_name: 'frontend' },
      github: {
        createRepository: createRepositoryMock,
      } as never,
      userLogin: 'octo',
      plan: makePlan(),
    })

    expect(calls.slice(0, 4)).toEqual([
      'shallow:backend',
      'unshallow:backend',
      'shallow:frontend',
      'unshallow:frontend',
    ])
    expect(calls.slice(4)).toEqual([
      'create:demo',
      'create:backend',
      'create:frontend',
    ])
  })

  test('checks backend and frontend Git repository roots before remote planning', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    isGitRepoRootMock.mockImplementation(async (dir: string) => !dir.endsWith('frontend'))

    await expect(checkChildRepositoryRoots({ backendDir, frontendDir })).resolves.toBe(false)

    expect(isGitRepoRootMock).toHaveBeenCalledWith(backendDir)
    expect(isGitRepoRootMock).toHaveBeenCalledWith(frontendDir)
  })

  test('does not create GitHub repositories when fetching full child history fails', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    isShallowRepoMock.mockImplementation(async () => true)
    unshallowRepoMock.mockImplementation(async () => false)

    await expect(applyRepoInitPlan({
      projectDir,
      backendDir,
      frontendDir,
      config: { name: 'demo', backend_name: 'backend', frontend_name: 'frontend' },
      github: {
        createRepository: createRepositoryMock,
      } as never,
      userLogin: 'octo',
      plan: makePlan(),
    })).rejects.toThrow('Failed to fetch full git history')

    expect(createRepositoryMock).not.toHaveBeenCalled()
  })
})
