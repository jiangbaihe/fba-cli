import { describe, expect, test } from 'bun:test'
import {
  buildMainRepositoryChangePlan,
  buildOriginSyncPlan,
  buildSyncPlan,
  buildUpstreamSyncPlan,
  classifySyncState,
  convertGitmodulesChecksToSyncIssues,
  getBlockingSyncPrecheckIssues,
  getMainRepositoryChangePlan,
  getOriginSyncOrder,
  getSyncOrder,
  getUpstreamSyncOrder,
  type OriginSyncTarget,
  type SyncRepositoryProbe,
  type UpstreamSyncTarget,
} from '../src/commands/repo/internal/sync.ts'
import {
  mapConflictChoiceToGitSide,
  type ConflictOperation,
} from '../src/commands/repo/internal/sync-conflicts.ts'

function probe(overrides: Partial<SyncRepositoryProbe> = {}): SyncRepositoryProbe {
  return {
    role: 'backend',
    label: 'Backend',
    dir: 'server',
    exists: true,
    isGitRoot: true,
    isShallow: false,
    originUrl: 'https://github.com/acme/server.git',
    upstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
    expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
    porcelainStatus: [],
    currentBranch: 'main',
    remoteBranchRef: 'abc123',
    aheadBehind: { ahead: 0, behind: 1 },
    fetchOk: true,
    ...overrides,
  }
}

describe('repo sync planning', () => {
  test('uses main, backend, frontend sync order for origin planning', () => {
    expect(getSyncOrder()).toEqual(['main', 'backend', 'frontend'])
  })

  test('plans fast-forward and up-to-date repositories', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        dir: '.',
        expectedUpstreamUrl: undefined,
        aheadBehind: { ahead: 0, behind: 0 },
      }),
      backend: probe({
        aheadBehind: { ahead: 0, behind: 2 },
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        originUrl: 'https://github.com/acme/web.git',
        upstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
        expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
        aheadBehind: { ahead: 0, behind: 0 },
      }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items.map((item) => item.role)).toEqual(['main', 'backend', 'frontend'])
      expect(result.items.map((item) => item.state)).toEqual(['up-to-date', 'fast-forward', 'up-to-date'])
      expect(result.items.filter((item) => item.shouldUpdate).map((item) => item.role)).toEqual(['backend'])
    }
  })

  test('blocks missing origin, detached HEAD, dirty worktree, shallow repo, and missing remote branch', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        originUrl: null,
        currentBranch: null,
        porcelainStatus: [' M .gitmodules'],
        expectedUpstreamUrl: undefined,
      }),
      backend: probe({
        isShallow: true,
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        remoteBranchRef: null,
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'main.origin' }),
        expect.objectContaining({ code: 'main.branch' }),
        expect.objectContaining({ code: 'main.workingTree' }),
        expect.objectContaining({ code: 'backend.shallow' }),
        expect.objectContaining({ code: 'frontend.remoteBranch' }),
      ]))
    }
  })

  test('does not report fetch failures when local prechecks already block sync', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        originUrl: null,
        fetchOk: false,
        expectedUpstreamUrl: undefined,
      }),
      backend: probe({
        porcelainStatus: [' M pyproject.toml'],
        fetchOk: false,
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        isShallow: true,
        fetchOk: false,
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).not.toContain('main.fetch')
      expect(result.errors.map((error) => error.code)).not.toContain('backend.fetch')
      expect(result.errors.map((error) => error.code)).not.toContain('frontend.fetch')
    }
  })

  test('blocks fetch failures and unknown comparisons before apply', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        expectedUpstreamUrl: undefined,
      }),
      backend: probe({
        fetchOk: false,
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        aheadBehind: null,
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'backend.fetch' }),
        expect.objectContaining({ code: 'frontend.compare' }),
      ]))
    }
  })

  test('blocks ahead and diverged repositories', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        expectedUpstreamUrl: undefined,
        aheadBehind: { ahead: 0, behind: 1 },
      }),
      backend: probe({
        aheadBehind: { ahead: 2, behind: 0 },
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        aheadBehind: { ahead: 1, behind: 1 },
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'backend.ahead' }),
        expect.objectContaining({ code: 'frontend.diverged' }),
      ]))
    }
  })

  test('warns but does not block mismatched child upstream', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        expectedUpstreamUrl: undefined,
      }),
      backend: probe({
        upstreamUrl: 'https://github.com/acme/custom-upstream.git',
      }),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        upstreamUrl: null,
        expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
      }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'backend.upstream' }),
        expect.objectContaining({ code: 'frontend.upstream' }),
      ]))
    }
  })

  test('blocks sync when gitmodules checks are not clean', () => {
    const result = buildSyncPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        expectedUpstreamUrl: undefined,
      }),
      backend: probe(),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
      }),
    }, {
      gitmodulesErrors: convertGitmodulesChecksToSyncIssues([
        { code: 'gitmodules.file', level: 'warn', message: 'missing .gitmodules' },
      ]),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({
        code: 'gitmodules.file',
        label: '.gitmodules',
      }))
    }
  })

  test('separates blocking precheck issues from wizard-handled branch states', () => {
    const issues = [
      { role: 'main', label: 'Main', code: 'main.workingTree', message: 'dirty' },
      { role: 'backend', label: 'Backend', code: 'backend.ahead', message: 'ahead' },
      { role: 'frontend', label: 'Frontend', code: 'frontend.diverged', message: 'diverged' },
      { role: 'backend', label: 'Backend', code: 'backend.remoteBranch', message: 'missing' },
    ] as const

    expect(getBlockingSyncPrecheckIssues([...issues])).toEqual([
      expect.objectContaining({ code: 'main.workingTree' }),
    ])
  })

  test('separates committable main repository pointer changes from unrelated changes', () => {
    expect(getMainRepositoryChangePlan(
      [' M backend', 'M  .gitmodules', '?? README.md'],
      ['.gitmodules', 'backend', 'frontend'],
    )).toEqual({
      committablePaths: ['backend', '.gitmodules'],
      unrelatedLines: ['?? README.md'],
    })
  })

  test('does not treat gitmodules edits as submodule pointer changes', async () => {
    const result = await buildMainRepositoryChangePlan({
      porcelainStatus: ['M  .gitmodules'],
      allowedPaths: ['backend', 'frontend'],
      hasPointerChange: async () => true,
    })

    expect(result).toEqual({
      committablePaths: [],
      unrelatedLines: ['M  .gitmodules'],
    })
  })

  test('builds committable main pointer plans only from real submodule pointer changes', async () => {
    const result = await buildMainRepositoryChangePlan({
      porcelainStatus: [' M backend', ' M frontend', '?? README.md'],
      allowedPaths: ['backend', 'frontend'],
      hasPointerChange: async (path) => path === 'backend',
    })

    expect(result).toEqual({
      committablePaths: ['backend'],
      unrelatedLines: ['?? README.md'],
    })
  })

  test('treats unreadable submodule pointer state as unrelated work', async () => {
    const result = await buildMainRepositoryChangePlan({
      porcelainStatus: [' M backend'],
      allowedPaths: ['backend'],
      hasPointerChange: async () => null,
    })

    expect(result).toEqual({
      committablePaths: [],
      unrelatedLines: [' M backend'],
    })
  })
})

describe('repo sync origin and upstream action planning', () => {
  function originTarget(
    overrides: Partial<SyncRepositoryProbe> = {},
    targetOverrides: Partial<Omit<OriginSyncTarget, 'probe'>> = {},
  ): OriginSyncTarget {
    return {
      probe: probe(overrides),
      remoteBranchRef: 'origin/main',
      aheadBehind: overrides.aheadBehind ?? { ahead: 0, behind: 1 },
      ...targetOverrides,
    }
  }

  function upstreamTarget(overrides: Partial<UpstreamSyncTarget> = {}): UpstreamSyncTarget {
    return {
      probe: probe(),
      remoteBranchRef: 'upstream/main',
      upstreamBranch: 'main',
      aheadBehind: { ahead: 0, behind: 1 },
      availableBranches: ['main', 'dev'],
      ...overrides,
    }
  }

  test('syncs origin main before child repositories and keeps upstream child-only', () => {
    expect(getOriginSyncOrder()).toEqual(['main', 'backend', 'frontend'])
    expect(getUpstreamSyncOrder()).toEqual(['backend', 'frontend'])
  })

  test('classifies ahead behind counts without mutating probes', () => {
    expect(classifySyncState(probe({ aheadBehind: { ahead: 0, behind: 0 } }))).toBe('up-to-date')
    expect(classifySyncState(probe({ aheadBehind: { ahead: 0, behind: 2 } }))).toBe('fast-forward')
    expect(classifySyncState(probe({ aheadBehind: { ahead: 2, behind: 0 } }))).toBe('ahead')
    expect(classifySyncState(probe({ aheadBehind: { ahead: 1, behind: 1 } }))).toBe('diverged')
  })

  test('plans origin actions with rebase recommended for diverged local commits', () => {
    const result = buildOriginSyncPlan([
      originTarget({ role: 'backend', label: 'Backend', aheadBehind: { ahead: 0, behind: 2 } }),
      originTarget({ role: 'frontend', label: 'Frontend', aheadBehind: { ahead: 2, behind: 0 } }),
      originTarget({ role: 'main', label: 'Main', aheadBehind: { ahead: 1, behind: 1 } }),
    ])

    expect(result.map((item) => [item.role, item.recommendedAction])).toEqual([
      ['main', 'rebase-origin'],
      ['backend', 'fast-forward-origin'],
      ['frontend', 'push-or-skip'],
    ])
    expect(result.find((item) => item.role === 'main')?.actions)
      .toEqual(['rebase-origin', 'merge-origin', 'skip', 'cancel'])
  })

  test('recommends push or skip when origin current branch is missing', () => {
    const result = buildOriginSyncPlan([
      originTarget({
        role: 'backend',
        label: 'Backend',
      }, {
        remoteBranchRef: null,
        aheadBehind: null,
      }),
    ])

    expect(result[0]?.recommendedAction).toBe('push-or-skip')
    expect(result[0]?.actions).toEqual(['push-or-skip', 'skip', 'cancel'])
  })

  test('warns before rebasing commits that are already on origin', () => {
    const result = buildOriginSyncPlan([
      originTarget({
        role: 'backend',
        label: 'Backend',
        aheadBehind: { ahead: 1, behind: 1 },
        pushedLocalCommits: true,
      }),
    ])

    expect(result[0]?.recommendedAction).toBe('merge-origin')
    expect(result[0]?.warnings).toContain('already-pushed-local-commits')
  })

  test('plans upstream only for backend and frontend with branch choices', () => {
    const result = buildUpstreamSyncPlan([
      upstreamTarget({
        probe: probe({ role: 'main', label: 'Main' }),
      }),
      upstreamTarget({
        probe: probe({ role: 'backend', label: 'Backend', aheadBehind: { ahead: 0, behind: 2 } }),
      }),
      upstreamTarget({
        probe: probe({ role: 'frontend', label: 'Frontend' }),
        remoteBranchRef: null,
        upstreamBranch: null,
        aheadBehind: null,
      }),
    ])

    expect(result.map((item) => item.role)).toEqual(['backend', 'frontend'])
    expect(result.map((item) => item.recommendedAction)).toEqual([
      'fast-forward-upstream',
      'choose-upstream-branch',
    ])
    expect(result[1]?.availableBranches).toEqual(['main', 'dev'])
  })

  test('recommends upstream rebase for diverged child repositories', () => {
    const result = buildUpstreamSyncPlan([
      upstreamTarget({
        probe: probe({ role: 'backend', label: 'Backend', aheadBehind: { ahead: 1, behind: 1 } }),
        aheadBehind: { ahead: 1, behind: 1 },
      }),
    ])

    expect(result[0]?.recommendedAction).toBe('rebase-upstream')
    expect(result[0]?.actions).toEqual(['rebase-upstream', 'merge-upstream', 'skip', 'cancel'])
  })

  test('skips upstream ahead when official upstream has no new commits', () => {
    const result = buildUpstreamSyncPlan([
      upstreamTarget({
        probe: probe({
          role: 'backend',
          label: 'Backend',
          aheadBehind: { ahead: 0, behind: 0 },
        }),
        aheadBehind: { ahead: 1, behind: 0 },
      }),
    ])

    expect(result[0]?.state).toBe('ahead')
    expect(result[0]?.recommendedAction).toBe('skip')
    expect(result[0]?.actions).toEqual(['skip', 'cancel'])
    expect(result[0]?.warnings).toEqual([])
  })

  test('does not show rebase warnings for upstream ahead even when local commits are published', () => {
    const result = buildUpstreamSyncPlan([
      upstreamTarget({
        probe: probe({
          role: 'backend',
          label: 'Backend',
          aheadBehind: { ahead: 0, behind: 0 },
          pushedLocalCommits: true,
        }),
        aheadBehind: { ahead: 2, behind: 0 },
      }),
    ])

    expect(result[0]?.state).toBe('ahead')
    expect(result[0]?.recommendedAction).toBe('skip')
    expect(result[0]?.warnings).toEqual([])
  })

  test('warns before rebasing child commits that are already published to origin', () => {
    const result = buildUpstreamSyncPlan([
      upstreamTarget({
        probe: probe({
          role: 'backend',
          label: 'Backend',
          aheadBehind: { ahead: 0, behind: 0 },
        }),
        aheadBehind: { ahead: 1, behind: 1 },
      }),
    ])

    expect(result[0]?.recommendedAction).toBe('merge-upstream')
    expect(result[0]?.warnings).toContain('already-pushed-local-commits')
  })
})

describe('repo sync command conflict helpers', () => {
  test('maps conflict choices for merge and rebase operations', () => {
    expect(mapConflictChoiceToGitSide('merge' satisfies ConflictOperation, 'local')).toBe('ours')
    expect(mapConflictChoiceToGitSide('merge' satisfies ConflictOperation, 'incoming')).toBe('theirs')
    expect(mapConflictChoiceToGitSide('rebase' satisfies ConflictOperation, 'local')).toBe('theirs')
    expect(mapConflictChoiceToGitSide('rebase' satisfies ConflictOperation, 'incoming')).toBe('ours')
  })

})
