import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildDefaultRemotePlan,
  formatGitHubRepoInitError,
  isGitHubHttpsUrl,
  normalizeRemotePlan,
  validateDistinctRemotePlan,
  preferExistingRemotePlan,
  renderGitmodules,
  resolvePromptTextValue,
  tryNormalizeRemotePlan,
  upsertGitmodulesContent,
  validateGitHubOwnerName,
} from '../src/commands/repo/internal/init.ts'
import {
  readStrictProjectConfig,
} from '../src/commands/repo/internal/project.ts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = join(tmpdir(), `fba-repo-init-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

describe('repo init planning helpers', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('builds default GitHub remote URLs', () => {
    expect(buildDefaultRemotePlan({
      owner: 'acme',
      projectName: 'jubao-mes',
      backendName: 'server',
      frontendName: 'web',
    })).toEqual({
      main: 'https://github.com/acme/jubao-mes.git',
      backend: 'https://github.com/acme/server.git',
      frontend: 'https://github.com/acme/web.git',
    })
  })

  test('prefers existing GitHub remote URLs over generated defaults', () => {
    expect(preferExistingRemotePlan({
      generated: {
        main: 'https://github.com/octo/demo.git',
        backend: 'https://github.com/octo/backend.git',
        frontend: 'https://github.com/octo/frontend.git',
      },
      mainOrigin: 'https://github.com/org/demo.git',
      backendOrigin: null,
      frontendOrigin: 'git@github.com:org/frontend.git',
      gitmodulesBackendUrl: 'https://github.com/org/backend.git',
      gitmodulesFrontendUrl: 'https://github.com/org/frontend.git',
    })).toEqual({
      main: 'https://github.com/org/demo.git',
      backend: 'https://github.com/org/backend.git',
      frontend: 'https://github.com/org/frontend.git',
    })
  })

  test('does not treat official template remotes as user child origins', () => {
    expect(preferExistingRemotePlan({
      generated: {
        main: 'https://github.com/octo/demo.git',
        backend: 'https://github.com/octo/backend.git',
        frontend: 'https://github.com/octo/frontend.git',
      },
      mainOrigin: 'https://github.com/octo/demo.git',
      backendOrigin: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      frontendOrigin: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
    })).toEqual({
      main: 'https://github.com/octo/demo.git',
      backend: 'https://github.com/octo/backend.git',
      frontend: 'https://github.com/octo/frontend.git',
    })
  })

  test('prefers gitmodules child URLs when existing child origin is still official template', () => {
    expect(preferExistingRemotePlan({
      generated: {
        main: 'https://github.com/octo/demo.git',
        backend: 'https://github.com/octo/backend.git',
        frontend: 'https://github.com/octo/frontend.git',
      },
      backendOrigin: 'https://github.com/fastapi-practices/fastapi-best-architecture.git',
      frontendOrigin: 'https://github.com/fastapi-practices/fastapi-best-architecture-ui.git',
      gitmodulesBackendUrl: 'https://github.com/acme/backend.git',
      gitmodulesFrontendUrl: 'https://github.com/acme/frontend.git',
    })).toEqual({
      main: 'https://github.com/octo/demo.git',
      backend: 'https://github.com/acme/backend.git',
      frontend: 'https://github.com/acme/frontend.git',
    })
  })

  test('renders gitmodules for backend and frontend', () => {
    expect(renderGitmodules({
      backendName: 'server',
      backendUrl: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendUrl: 'https://github.com/acme/web.git',
    })).toBe([
      '[submodule "server"]',
      '\tpath = server',
      '\turl = https://github.com/acme/server.git',
      '[submodule "web"]',
      '\tpath = web',
      '\turl = https://github.com/acme/web.git',
      '',
    ].join('\n'))
  })

  test('upserts backend and frontend gitmodules while preserving unrelated submodules', () => {
    expect(upsertGitmodulesContent([
      '# keep this comment',
      '[submodule "docs"]',
      '\tpath = docs',
      '\turl = https://github.com/acme/docs.git',
      '[submodule "server"]',
      '\tpath = old-server',
      '\turl = https://github.com/acme/old-server.git',
      '',
    ].join('\n'), {
      backendName: 'server',
      backendUrl: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendUrl: 'https://github.com/acme/web.git',
    })).toBe([
      '# keep this comment',
      '[submodule "docs"]',
      '\tpath = docs',
      '\turl = https://github.com/acme/docs.git',
      '',
      '[submodule "server"]',
      '\tpath = server',
      '\turl = https://github.com/acme/server.git',
      '[submodule "web"]',
      '\tpath = web',
      '\turl = https://github.com/acme/web.git',
      '',
    ].join('\n'))
  })

  test('upserts gitmodules by target paths when section names differ', () => {
    expect(upsertGitmodulesContent([
      '[submodule "old-backend"]',
      '\tpath = server',
      '\turl = https://github.com/acme/old-server.git',
      '[submodule "docs"]',
      '\tpath = docs',
      '\turl = https://github.com/acme/docs.git',
      '[submodule "old-frontend"]',
      '\tpath = web',
      '\turl = https://github.com/acme/old-web.git',
      '',
    ].join('\n'), {
      backendName: 'server',
      backendUrl: 'https://github.com/acme/server.git',
      frontendName: 'web',
      frontendUrl: 'https://github.com/acme/web.git',
    })).toBe([
      '[submodule "docs"]',
      '\tpath = docs',
      '\turl = https://github.com/acme/docs.git',
      '',
      '[submodule "server"]',
      '\tpath = server',
      '\turl = https://github.com/acme/server.git',
      '[submodule "web"]',
      '\tpath = web',
      '\turl = https://github.com/acme/web.git',
      '',
    ].join('\n'))
  })

  test('reads strict project config without default fallbacks', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    }), 'utf-8')

    expect(readStrictProjectConfig(projectDir)).toEqual({
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    })
  })

  test('rejects repo init config missing required names', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: 'server',
    }), 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      '.fba.json must include name, backend_name, and frontend_name',
    )
  })

  test('reports invalid project config JSON clearly', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), '{', 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      'Unable to read .fba.json',
    )
  })

  test('rejects non-object project config content', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), 'null', 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      '.fba.json must include name, backend_name, and frontend_name',
    )
  })

  test('rejects child repository names that can escape the project directory', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: '../server',
      frontend_name: 'web',
    }), 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      '.fba.json backend_name and frontend_name must be plain directory names',
    )
  })

  test('rejects child repository names that require quoted git porcelain paths', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: 'my backend',
      frontend_name: 'web',
    }), 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      '.fba.json backend_name and frontend_name must be plain directory names',
    )
  })

  test('rejects duplicate backend and frontend repository directories', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: 'service',
      frontend_name: ' service ',
    }), 'utf-8')

    expect(() => readStrictProjectConfig(projectDir)).toThrow(
      '.fba.json backend_name and frontend_name must be different',
    )
  })

  test('rejects child directories that differ only by case on case-insensitive platforms', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: 'jubao-mes',
      backend_name: 'api',
      frontend_name: 'API',
    }), 'utf-8')

    if (process.platform === 'linux') {
      expect(readStrictProjectConfig(projectDir)).toEqual({
        name: 'jubao-mes',
        backend_name: 'api',
        frontend_name: 'API',
      })
    } else {
      expect(() => readStrictProjectConfig(projectDir)).toThrow(
        '.fba.json backend_name and frontend_name must be different',
      )
    }
  })

  test('returns trimmed project and child repository names', () => {
    const projectDir = makeTempDir()
    writeFileSync(join(projectDir, '.fba.json'), JSON.stringify({
      name: ' jubao-mes ',
      backend_name: ' server ',
      frontend_name: ' web ',
    }), 'utf-8')

    expect(readStrictProjectConfig(projectDir)).toEqual({
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    })
  })

  test('normalizes remote plans and rejects non-GitHub HTTPS URLs', () => {
    expect(normalizeRemotePlan({
      main: 'https://github.com/acme/jubao-mes',
      backend: 'https://github.com/acme/server.git',
      frontend: 'https://github.com/acme/web',
    })).toEqual({
      main: {
        owner: 'acme',
        repo: 'jubao-mes',
        normalizedUrl: 'https://github.com/acme/jubao-mes.git',
      },
      backend: {
        owner: 'acme',
        repo: 'server',
        normalizedUrl: 'https://github.com/acme/server.git',
      },
      frontend: {
        owner: 'acme',
        repo: 'web',
        normalizedUrl: 'https://github.com/acme/web.git',
      },
    })

    expect(() => normalizeRemotePlan({
      main: 'git@github.com:acme/jubao-mes.git',
      backend: 'https://github.com/acme/server.git',
      frontend: 'https://github.com/acme/web.git',
    })).toThrow(/GitHub HTTPS URL/)

    expect(() => normalizeRemotePlan({
      main: 'https://ghp_secret@github.com/acme/jubao-mes.git',
      backend: 'https://github.com/acme/server.git',
      frontend: 'https://github.com/acme/web.git',
    })).toThrow('https://***@github.com/acme/jubao-mes.git')
  })

  test('rejects duplicate GitHub repositories across repo init roles', () => {
    const plan = normalizeRemotePlan({
      main: 'https://github.com/acme/demo.git',
      backend: 'https://github.com/acme/demo',
      frontend: 'https://github.com/acme/web.git',
    })

    expect(validateDistinctRemotePlan(plan)).toContain('must be different')
  })

  test('detects GitHub HTTPS repository URLs', () => {
    expect(isGitHubHttpsUrl('https://github.com/acme/api.git')).toBe(true)
    expect(isGitHubHttpsUrl('git@github.com:acme/api.git')).toBe(false)
  })

  test('returns a validation result instead of throwing for invalid remote plans', () => {
    const result = tryNormalizeRemotePlan({
      main: 'https://github.com/acme/team/jubao-mes.git',
      backend: 'https://github.com/acme/server.git',
      frontend: 'https://github.com/acme/web.git',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('GitHub HTTPS URL')
    }
  })

  test('validates GitHub owner names before building default remotes', () => {
    expect(validateGitHubOwnerName('acme')).toBeUndefined()
    expect(validateGitHubOwnerName('acme-team')).toBeUndefined()
    expect(validateGitHubOwnerName('')).toBe('Owner 不能为空')
    expect(validateGitHubOwnerName('foo/bar')).toContain('Owner')
    expect(validateGitHubOwnerName('-acme')).toContain('Owner')
    expect(validateGitHubOwnerName('acme-')).toContain('Owner')
  })

  test('resolves empty text prompt input to the visible default value', () => {
    expect(resolvePromptTextValue('', 'jiangbaihe')).toBe('jiangbaihe')
    expect(resolvePromptTextValue('   ', 'jiangbaihe')).toBe('jiangbaihe')
    expect(resolvePromptTextValue(' acme ', 'jiangbaihe')).toBe('acme')
  })

  test('formats common GitHub API errors with actionable hints', () => {
    expect(formatGitHubRepoInitError({ status: 401 })).toContain('GitHub Token')
    expect(formatGitHubRepoInitError({ status: 403 })).toContain('权限')
    expect(formatGitHubRepoInitError({ status: 422 })).toContain('已存在')
    expect(formatGitHubRepoInitError(new Error('network down'))).toContain('network down')

    const formatted = formatGitHubRepoInitError(new Error(
      'request failed for https://user:ghp_secret1234567890abcdef@github.com/acme/repo.git Authorization: Bearer ghp_secret1234567890abcdef',
    ))
    expect(formatted).not.toContain('ghp_secret1234567890abcdef')
    expect(formatted).toContain('https://***@github.com/acme/repo.git')
    expect(formatted).toContain('Authorization: Bearer ***')
  })
})
