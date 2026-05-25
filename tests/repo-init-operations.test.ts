import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ensureRemoteMock = mock(async () => 'unchanged')
const initSubmodulesMock = mock(async () => true)
const initGitRepoMock = mock(async () => true)
const getCurrentBranchMock = mock(async () => 'main')
const getRemoteBranchRefMock = mock(async () => 'origin-main')
const checkoutBranchMock = mock(async () => true)
const checkoutNewBranchAtHeadMock = mock(async () => true)
const isGitRepoRootMock = mock(async () => true)
const isShallowRepoMock = mock(async () => false)
const listLocalBranchesMock = mock(async () => ['main'])
const listRemoteBranchesMock = mock(async () => ['main'])
const unshallowRepoMock = mock(async () => true)
const getRemoteUrlMock = mock(async () => null)
const removeRemoteMock = mock(async () => {})
const getHeadCommitMock = mock(async () => 'HEAD')
const checkoutDetachedMock = mock(async () => true)
const checkoutExistingBranchMock = mock(async () => true)
const deleteLocalBranchMock = mock(async () => true)
const getMissingSubmoduleGitlinkPathsMock = mock(async () => [])

mock.module('@clack/prompts', () => ({
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  },
}))

mock.module('../src/commands/repo/internal/git.ts', () => ({
  checkoutBranch: checkoutBranchMock,
  checkoutDetached: checkoutDetachedMock,
  checkoutExistingBranch: checkoutExistingBranchMock,
  checkoutNewBranchAtHead: checkoutNewBranchAtHeadMock,
  deleteLocalBranch: deleteLocalBranchMock,
  deinitSubmodules: mock(async () => true),
  ensureRemote: ensureRemoteMock,
  getCurrentBranch: getCurrentBranchMock,
  getHeadCommit: getHeadCommitMock,
  getMissingSubmoduleGitlinkPaths: getMissingSubmoduleGitlinkPathsMock,
  getRemoteBranchRef: getRemoteBranchRefMock,
  getRemoteUrl: getRemoteUrlMock,
  initSubmodules: initSubmodulesMock,
  initGitRepo: initGitRepoMock,
  isGitRepoRoot: isGitRepoRootMock,
  listLocalBranches: listLocalBranchesMock,
  listRemoteBranches: listRemoteBranchesMock,
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
    getCurrentBranchMock.mockReset()
    getCurrentBranchMock.mockImplementation(async () => 'main')
    getHeadCommitMock.mockReset()
    getHeadCommitMock.mockImplementation(async (dir: string) => (
      dir.endsWith('backend') ? 'backend-head' : 'frontend-head'
    ))
    getMissingSubmoduleGitlinkPathsMock.mockReset()
    getMissingSubmoduleGitlinkPathsMock.mockImplementation(async () => [])
    checkoutDetachedMock.mockReset()
    checkoutDetachedMock.mockImplementation(async () => true)
    checkoutExistingBranchMock.mockReset()
    checkoutExistingBranchMock.mockImplementation(async () => true)
    deleteLocalBranchMock.mockReset()
    deleteLocalBranchMock.mockImplementation(async () => true)
    getRemoteBranchRefMock.mockReset()
    getRemoteBranchRefMock.mockImplementation(async () => 'origin-main')
    checkoutBranchMock.mockReset()
    checkoutBranchMock.mockImplementation(async () => true)
    checkoutNewBranchAtHeadMock.mockReset()
    checkoutNewBranchAtHeadMock.mockImplementation(async () => true)
    isGitRepoRootMock.mockReset()
    isGitRepoRootMock.mockImplementation(async () => true)
    isShallowRepoMock.mockReset()
    isShallowRepoMock.mockImplementation(async () => false)
    listLocalBranchesMock.mockReset()
    listLocalBranchesMock.mockImplementation(async () => [])
    listRemoteBranchesMock.mockReset()
    listRemoteBranchesMock.mockImplementation(async () => ['main'])
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

  test('fetches full child history before creating missing GitHub repositories', async () => {
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
    ensureRemoteMock.mockImplementation(async (dir: string, name: string) => {
      calls.push(`remote:${dir.endsWith('backend') ? 'backend' : dir.endsWith('frontend') ? 'frontend' : 'main'}:${name}`)
      return 'unchanged'
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

    expect(calls.indexOf('unshallow:backend')).toBeLessThan(calls.indexOf('create:backend'))
    expect(calls.indexOf('unshallow:frontend')).toBeLessThan(calls.indexOf('create:frontend'))
    expect(calls.indexOf('unshallow:backend')).toBeLessThan(calls.indexOf('remote:backend:origin'))
    expect(calls.indexOf('unshallow:frontend')).toBeLessThan(calls.indexOf('remote:frontend:origin'))
    expect(calls.indexOf('create:demo')).toBeGreaterThan(calls.indexOf('unshallow:frontend'))
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

  test('preserves the original apply error when rollback also fails', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    ensureRemoteMock.mockImplementation(async (dir: string, name: string) => {
      if (dir === backendDir && name === 'origin') {
        throw new Error('remote update failed')
      }
      if (dir === projectDir && name === 'origin') {
        throw new Error('rollback failed')
      }
      return 'unchanged'
    })
    const snapshot = {
      projectDir,
      backendDir,
      frontendDir,
      mainHadGit: true,
      mainIsGitRoot: true,
      backendDirectory: { existed: true, isGitRoot: true, wasEmpty: false },
      frontendDirectory: { existed: true, isGitRoot: true, wasEmpty: false },
      gitmodules: 'before',
      mainRemotes: { origin: 'https://github.com/acme/main.git', upstream: null },
      backendRemotes: { origin: null, upstream: null },
      frontendRemotes: { origin: null, upstream: null },
      mainCheckout: { branch: 'main', head: 'main-head', localBranches: ['main'] },
      backendCheckout: { branch: 'main', head: 'backend-head', localBranches: ['main'] },
      frontendCheckout: { branch: 'main', head: 'frontend-head', localBranches: ['main'] },
      submoduleMetadata: { backend: null, frontend: null },
    }

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
      snapshot,
    })).rejects.toThrow('remote update failed')
  })

  test('keeps existing child origin until shallow repositories are unshallowed', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    const calls: string[] = []
    isShallowRepoMock.mockImplementation(async () => true)
    getRemoteUrlMock.mockImplementation(async (dir: string, name: string) => {
      if (name !== 'origin') return null
      if (dir.endsWith('backend')) return 'https://github.com/fastapi-practices/fastapi-best-architecture.git'
      if (dir.endsWith('frontend')) return 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git'
      return null
    })
    ensureRemoteMock.mockImplementation(async (dir: string, name: string) => {
      calls.push(`remote:${dir.endsWith('backend') ? 'backend' : dir.endsWith('frontend') ? 'frontend' : 'main'}:${name}`)
      return 'unchanged'
    })
    unshallowRepoMock.mockImplementation(async (dir: string) => {
      calls.push(`unshallow:${dir.endsWith('backend') ? 'backend' : 'frontend'}`)
      return true
    })
    const plan = {
      ...makePlan(),
      main: { ...makePlan().main, action: 'reuse' },
      backend: { ...makePlan().backend, action: 'reuse' },
      frontend: { ...makePlan().frontend, action: 'reuse' },
    } as ReturnType<typeof makePlan>

    await applyRepoInitPlan({
      projectDir,
      backendDir,
      frontendDir,
      config: { name: 'demo', backend_name: 'backend', frontend_name: 'frontend' },
      github: {
        createRepository: createRepositoryMock,
      } as never,
      userLogin: 'octo',
      plan,
    })

    expect(calls.indexOf('unshallow:backend')).toBeLessThan(calls.indexOf('remote:backend:origin'))
    expect(calls.indexOf('unshallow:frontend')).toBeLessThan(calls.indexOf('remote:frontend:origin'))
    expect(createRepositoryMock).not.toHaveBeenCalled()
  })

  test('sets planned existing child origin before unshallowing when origin is missing', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    const calls: string[] = []
    isShallowRepoMock.mockImplementation(async () => true)
    getRemoteUrlMock.mockImplementation(async () => null)
    ensureRemoteMock.mockImplementation(async (dir: string, name: string) => {
      calls.push(`remote:${dir.endsWith('backend') ? 'backend' : dir.endsWith('frontend') ? 'frontend' : 'main'}:${name}`)
      return 'unchanged'
    })
    unshallowRepoMock.mockImplementation(async (dir: string) => {
      calls.push(`unshallow:${dir.endsWith('backend') ? 'backend' : 'frontend'}`)
      return true
    })
    const plan = {
      ...makePlan(),
      main: { ...makePlan().main, action: 'reuse' },
      backend: { ...makePlan().backend, action: 'reuse' },
      frontend: { ...makePlan().frontend, action: 'reuse' },
    } as ReturnType<typeof makePlan>

    await applyRepoInitPlan({
      projectDir,
      backendDir,
      frontendDir,
      config: { name: 'demo', backend_name: 'backend', frontend_name: 'frontend' },
      github: {
        createRepository: createRepositoryMock,
      } as never,
      userLogin: 'octo',
      plan,
    })

    expect(calls.indexOf('remote:backend:origin')).toBeLessThan(calls.indexOf('unshallow:backend'))
    expect(calls.indexOf('remote:frontend:origin')).toBeLessThan(calls.indexOf('unshallow:frontend'))
    expect(createRepositoryMock).not.toHaveBeenCalled()
  })

  test('rolls back detached child branch repair when later apply fails', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? null : 'main'
    ))
    let backendBranches: string[] = []
    listLocalBranchesMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? backendBranches : ['main']
    ))
    checkoutNewBranchAtHeadMock.mockImplementation(async (_dir: string, branch: string) => {
      backendBranches = [...backendBranches, branch]
      return true
    })
    getHeadCommitMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? 'backend-before' : 'frontend-before'
    ))
    ensureRemoteMock.mockImplementation(async (dir: string, name: string) => {
      if (dir === projectDir && name === 'origin') throw new Error('main remote failed')
      return 'unchanged'
    })

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
    })).rejects.toThrow('main remote failed')

    expect(checkoutNewBranchAtHeadMock).toHaveBeenCalledWith(backendDir, 'main')
    expect(checkoutDetachedMock).toHaveBeenCalledWith(backendDir, 'backend-before')
    expect(deleteLocalBranchMock).toHaveBeenCalledWith(backendDir, 'main')
    expect(checkoutDetachedMock).not.toHaveBeenCalledWith(frontendDir, expect.any(String))
  })

  test('creates a local branch at the detached child HEAD during init repair', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? null : 'main'
    ))

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

    expect(listRemoteBranchesMock).toHaveBeenCalledWith(backendDir, 'origin')
    expect(checkoutNewBranchAtHeadMock).toHaveBeenCalledWith(backendDir, 'main')
    expect(checkoutNewBranchAtHeadMock).not.toHaveBeenCalledWith(frontendDir, 'main')
    expect(getRemoteBranchRefMock).not.toHaveBeenCalled()
    expect(checkoutBranchMock).not.toHaveBeenCalled()
  })

  test('creates a fallback local branch when detached child has no origin branches', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? null : 'main'
    ))
    listRemoteBranchesMock.mockImplementation(async () => [])

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

    expect(listRemoteBranchesMock).toHaveBeenCalledWith(backendDir, 'origin')
    expect(checkoutNewBranchAtHeadMock).toHaveBeenCalledWith(backendDir, 'main')
  })

  test('uses a non-conflicting local branch name when repairing detached child repos', async () => {
    const { projectDir, backendDir, frontendDir } = makeDirs()
    dirs.push(projectDir)
    const createRepositoryMock = mock(async () => ({ full_name: 'octo/repo', clone_url: 'https://github.com/octo/repo.git' }))
    getCurrentBranchMock.mockImplementation(async (dir: string) => (
      dir === backendDir ? null : 'main'
    ))
    listRemoteBranchesMock.mockImplementation(async () => ['main'])
    listLocalBranchesMock.mockImplementation(async () => ['main'])

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

    expect(checkoutNewBranchAtHeadMock).toHaveBeenCalledWith(backendDir, 'fba-repo-main')
  })
})
