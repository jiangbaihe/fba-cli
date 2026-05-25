import { describe, expect, test } from 'bun:test'
import {
  assessGitmodules,
  assessRepository,
  getRecommendedStatusActions,
  getOverallStatus,
  parseGitmodules,
} from '../src/commands/repo/internal/status.ts'

describe('repo status helpers', () => {
  test('aggregates overall status by highest severity', () => {
    expect(getOverallStatus([
      { code: 'a', level: 'ok', message: 'ok' },
      { code: 'b', level: 'warn', message: 'warn' },
    ])).toBe('warn')

    expect(getOverallStatus([
      { code: 'a', level: 'ok', message: 'ok' },
      { code: 'b', level: 'error', message: 'error' },
      { code: 'c', level: 'warn', message: 'warn' },
    ])).toBe('error')

    expect(getOverallStatus([])).toBe('ok')
  })

  test('parses gitmodules sections', () => {
    expect(parseGitmodules([
      '[submodule "server"]',
      '\tpath = server',
      '\turl = https://github.com/acme/server.git',
      '[submodule "web"]',
      '  path = web',
      '  url = https://github.com/acme/web.git',
      '',
    ].join('\n'))).toEqual({
      server: {
        path: 'server',
        url: 'https://github.com/acme/server.git',
      },
      web: {
        path: 'web',
        url: 'https://github.com/acme/web.git',
      },
    })
  })

  test('accepts gitmodules entries matching project directories and child origins', () => {
    const checks = assessGitmodules({
      content: [
        '[submodule "server"]',
        '\tpath = server',
        '\turl = https://github.com/acme/server.git',
        '[submodule "web"]',
        '\tpath = web',
        '\turl = https://github.com/acme/web.git',
        '',
      ].join('\n'),
      backendName: 'server',
      backendOrigin: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendOrigin: 'https://github.com/acme/web.git',
    })

    expect(getOverallStatus(checks)).toBe('ok')
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'gitmodules.backend.url',
      level: 'ok',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'gitmodules.frontend.url',
      level: 'ok',
    }))
  })

  test('accepts gitmodules entries whose section name differs from path', () => {
    const checks = assessGitmodules({
      content: [
        '[submodule "api"]',
        '\tpath = server',
        '\turl = https://github.com/acme/server.git',
        '[submodule "ui"]',
        '\tpath = web',
        '\turl = https://github.com/acme/web.git',
        '',
      ].join('\n'),
      backendName: 'server',
      backendOrigin: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendOrigin: 'https://github.com/acme/web.git',
    })

    expect(getOverallStatus(checks)).toBe('ok')
  })

  test('warns when gitmodules are missing or do not match child origins', () => {
    expect(assessGitmodules({
      content: null,
      backendName: 'server',
      backendOrigin: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendOrigin: 'https://github.com/acme/web.git',
    })).toEqual([
      expect.objectContaining({
        code: 'gitmodules.file',
        level: 'warn',
      }),
    ])

    const checks = assessGitmodules({
      content: [
        '[submodule "server"]',
        '\tpath = old-server',
        '\turl = https://github.com/acme/old-server.git',
        '',
      ].join('\n'),
      backendName: 'server',
      backendOrigin: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendOrigin: 'https://github.com/acme/web.git',
    })

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'gitmodules.backend.path',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'gitmodules.backend.url',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'gitmodules.frontend.entry',
      level: 'warn',
    }))
  })

  test('assesses missing and healthy repositories', () => {
    expect(assessRepository({
      role: 'backend',
      label: 'Backend',
      exists: false,
      isGitRepo: false,
      isGitRoot: false,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      currentBranch: null,
      expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      porcelainStatus: null,
    })).toEqual([
      expect.objectContaining({
        code: 'backend.dir',
        level: 'error',
      }),
    ])

    const healthy = assessRepository({
      role: 'backend',
      label: 'Backend',
      exists: true,
      isGitRepo: true,
      isGitRoot: true,
      isShallow: false,
      originUrl: 'https://github.com/acme/server.git',
      upstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      currentBranch: 'main',
      expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      porcelainStatus: [],
    })

    expect(getOverallStatus(healthy)).toBe('ok')
    expect(healthy).toContainEqual(expect.objectContaining({
      code: 'backend.origin',
      level: 'ok',
    }))
    expect(healthy).toContainEqual(expect.objectContaining({
      code: 'backend.workingTree',
      level: 'ok',
    }))
  })

  test('warns for shallow repositories, missing remotes, and dirty working trees', () => {
    const checks = assessRepository({
      role: 'frontend',
      label: 'Frontend',
      exists: true,
      isGitRepo: true,
      isGitRoot: true,
      isShallow: true,
      originUrl: null,
      upstreamUrl: 'https://github.com/example/wrong-upstream.git',
      currentBranch: null,
      expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
      porcelainStatus: [' M package.json', '?? tmp.txt'],
    })

    expect(getOverallStatus(checks)).toBe('warn')
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'frontend.shallow',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'frontend.origin',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'frontend.branch',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'frontend.upstream',
      level: 'warn',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'frontend.workingTree',
      level: 'warn',
    }))
  })

  test('blocks repo init suggestions for non-empty child directories that are not Git repositories', () => {
    const checks = assessRepository({
      role: 'backend',
      label: 'Backend',
      exists: true,
      isGitRepo: false,
      isGitRoot: false,
      isEmptyDirectory: false,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      currentBranch: null,
      expectedUpstreamUrl: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      porcelainStatus: null,
    })

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'backend.dirContent',
      level: 'error',
    }))
    expect(getRecommendedStatusActions(checks)).toEqual([])
  })

  test('warns when the main repository has an upstream remote', () => {
    const checks = assessRepository({
      role: 'main',
      label: 'Main',
      exists: true,
      isGitRepo: true,
      isGitRoot: true,
      isShallow: false,
      originUrl: 'https://github.com/acme/demo.git',
      upstreamUrl: 'https://github.com/acme/unexpected.git',
      currentBranch: 'main',
      expectedUpstreamUrl: undefined,
      porcelainStatus: [],
    })

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'main.upstream',
      level: 'warn',
    }))
  })

  test('redacts credentials from displayed remote URLs', () => {
    const checks = assessRepository({
      role: 'main',
      label: 'Main',
      exists: true,
      isGitRepo: true,
      isGitRoot: true,
      isShallow: false,
      originUrl: 'https://ghp_secret@github.com/acme/demo.git',
      upstreamUrl: 'https://user:token@github.com/acme/upstream.git',
      currentBranch: 'main',
      porcelainStatus: [],
    })

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'main.origin',
      detail: 'https://***@github.com/acme/demo.git',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'main.upstream',
      detail: 'https://***@github.com/acme/upstream.git',
    }))
  })

  test('recommends wizard actions from status checks', () => {
    expect(getRecommendedStatusActions([
      { code: 'backend.origin', level: 'warn', message: 'missing origin' },
      { code: 'frontend.upstream', level: 'warn', message: 'wrong upstream' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'backend.shallow', level: 'warn', message: 'shallow clone' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'main.shallow', level: 'warn', message: 'main shallow clone' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'main.branch', level: 'warn', message: 'main detached head' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'main.upstream', level: 'warn', message: 'main has upstream' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.branch', level: 'warn', message: 'backend detached head' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'frontend.git', level: 'error', message: 'frontend is not a git repo' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'backend.dirContent', level: 'error', message: 'backend is not an empty Git root' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'main.git', level: 'error', message: 'main is not a git repo' },
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'frontend.dir', level: 'error', message: 'missing frontend' },
      { code: 'gitmodules.file', level: 'warn', message: 'missing .gitmodules' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'main.git', level: 'ok', message: 'main is a git repo' },
      { code: 'main.root', level: 'ok', message: 'main is a git root' },
      { code: 'backend.git', level: 'ok', message: 'backend is a git repo' },
      { code: 'backend.root', level: 'ok', message: 'backend is a git root' },
      { code: 'backend.origin', level: 'ok', message: 'backend has origin' },
      { code: 'frontend.git', level: 'ok', message: 'frontend is a git repo' },
      { code: 'frontend.root', level: 'ok', message: 'frontend is a git root' },
      { code: 'frontend.origin', level: 'ok', message: 'frontend has origin' },
      { code: 'gitmodules.file', level: 'warn', message: 'missing .gitmodules' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'main.git', level: 'ok', message: 'main is a git repo' },
      { code: 'main.root', level: 'ok', message: 'main is a git root' },
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'frontend.dir', level: 'error', message: 'missing frontend' },
      { code: 'gitmodules.file', level: 'warn', message: 'missing .gitmodules' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'gitmodules.backend.entry', level: 'warn', message: 'missing backend entry' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'gitmodules.backend.path', level: 'warn', message: 'wrong backend path' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.dir', level: 'error', message: 'missing backend' },
      { code: 'gitmodules.backend.url', level: 'warn', message: 'origin missing while child is absent' },
    ])).toEqual(['init'])

    expect(getRecommendedStatusActions([
      { code: 'backend.workingTree', level: 'warn', message: 'dirty' },
    ])).toEqual([])

    expect(getRecommendedStatusActions([
      { code: 'backend.workingTree', level: 'ok', message: 'clean' },
    ])).toEqual(['sync', 'push'])

    expect(getRecommendedStatusActions([
      { code: 'main.dir', level: 'error', message: 'missing' },
    ])).toEqual([])
  })
})
