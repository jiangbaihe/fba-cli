import { describe, expect, test } from 'bun:test'
import {
  buildPushPlan,
  convertGitmodulesChecksToPushIssues,
  getPushOrder,
  markDryRunResult,
  markPushResult,
  runDryRunChecks,
  runPushSequence,
  summarizePushResults,
  type PushRepositoryProbe,
} from '../src/commands/repo/internal/push.ts'

function probe(overrides: Partial<PushRepositoryProbe> = {}): PushRepositoryProbe {
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
    ...overrides,
  }
}

describe('repo push planning', () => {
  test('uses backend, frontend, main push order', () => {
    expect(getPushOrder()).toEqual(['backend', 'frontend', 'main'])
  })

  test('builds pushable plan for clean repositories', () => {
    const result = buildPushPlan({
      main: probe({
        role: 'main',
        label: 'Main',
        dir: '.',
        upstreamUrl: null,
        expectedUpstreamUrl: undefined,
      }),
      backend: probe(),
      frontend: probe({
        role: 'frontend',
        label: 'Frontend',
        dir: 'web',
        originUrl: 'https://github.com/acme/web.git',
        upstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
        expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
      }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items.map((item) => item.role)).toEqual(['backend', 'frontend', 'main'])
      expect(result.items[0]).toEqual(expect.objectContaining({
        branch: 'main',
        originUrl: 'https://github.com/acme/server.git',
      }))
    }
  })

  test('blocks missing origin, detached HEAD, dirty worktree, and shallow child repos', () => {
    const result = buildPushPlan({
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
        isGitRoot: false,
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'main.origin' }),
        expect.objectContaining({ code: 'main.branch' }),
        expect.objectContaining({ code: 'main.workingTree' }),
        expect.objectContaining({ code: 'backend.shallow' }),
        expect.objectContaining({ code: 'frontend.gitRoot' }),
      ]))
    }
  })

  test('warns but does not block mismatched child upstream', () => {
    const result = buildPushPlan({
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

  test('blocks push when gitmodules checks are not clean', () => {
    const result = buildPushPlan({
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
      gitmodulesErrors: convertGitmodulesChecksToPushIssues([
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
})

describe('repo push execution summaries', () => {
  const planItems = [
    {
      role: 'backend',
      label: 'Backend',
      dir: 'server',
      branch: 'main',
      originUrl: 'https://github.com/acme/server.git',
    },
    {
      role: 'frontend',
      label: 'Frontend',
      dir: 'web',
      branch: 'main',
      originUrl: 'https://github.com/acme/web.git',
    },
    {
      role: 'main',
      label: 'Main',
      dir: '.',
      branch: 'main',
      originUrl: 'https://github.com/acme/app.git',
    },
  ] as const

  test('marks dry-run failures before real push', () => {
    const results = planItems.map((item, index) => markDryRunResult(item, index !== 1))

    expect(summarizePushResults(results)).toEqual({
      ok: false,
      pushed: [],
      failed: ['Frontend'],
      pending: ['Backend', 'Main'],
    })
  })

  test('summarizes successful dry-run checks as ready to push', () => {
    const results = planItems.map((item) => markDryRunResult(item, true))

    expect(summarizePushResults(results)).toEqual({
      ok: true,
      pushed: [],
      failed: [],
      pending: [],
    })
  })

  test('summarizes partial real push failure', () => {
    const results = [
      markPushResult(planItems[0], true),
      markPushResult(planItems[1], false),
      markPushResult(planItems[2], null),
    ]

    expect(summarizePushResults(results)).toEqual({
      ok: false,
      pushed: ['Backend'],
      failed: ['Frontend'],
      pending: ['Main'],
    })
  })

  test('runs dry-run for every repository before real push', async () => {
    const calls: string[] = []
    const results = await runDryRunChecks(planItems, async (item) => {
      calls.push(item.label)
      return item.role !== 'frontend'
    })

    expect(calls).toEqual(['Backend', 'Frontend', 'Main'])
    expect(summarizePushResults(results)).toEqual({
      ok: false,
      pushed: [],
      failed: ['Frontend'],
      pending: ['Backend', 'Main'],
    })
  })

  test('stops real push sequence after first failure', async () => {
    const calls: string[] = []
    const results = await runPushSequence(planItems, async (item) => {
      calls.push(item.label)
      return item.role !== 'frontend'
    })

    expect(calls).toEqual(['Backend', 'Frontend'])
    expect(summarizePushResults(results)).toEqual({
      ok: false,
      pushed: ['Backend'],
      failed: ['Frontend'],
      pending: ['Main'],
    })
  })
})
