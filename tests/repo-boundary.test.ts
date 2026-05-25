import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const rootDir = join(import.meta.dir, '..')
const repoCommandDir = join(rootDir, 'src', 'commands', 'repo')
const createCommandPath = join(rootDir, 'src', 'commands', 'create.ts')

describe('repo command module boundaries', () => {
  test('keeps repo-specific guidance inside the repo command module', () => {
    const claude = readFileSync(join(rootDir, 'CLAUDE.md'), 'utf-8')
    const readme = readFileSync(join(rootDir, 'README.md'), 'utf-8')
    const readmeEn = readFileSync(join(rootDir, 'README_en.md'), 'utf-8')
    const repoAgentsPath = join(repoCommandDir, 'AGENTS.md')
    const repoReadmePath = join(repoCommandDir, 'README.md')

    expect(existsSync(join(rootDir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(repoAgentsPath)).toBe(true)
    expect(existsSync(repoReadmePath)).toBe(true)
    expect(claude).not.toContain('Experimental repo command guidance')
    expect(readme).not.toContain('## 实验性：远程仓库维护')
    expect(readmeEn).not.toContain('## Experimental: Repository Maintenance')
  })

  test('keeps top-level repo command files as thin entrypoints', () => {
    for (const command of ['init', 'push', 'status', 'sync']) {
      const content = readFileSync(join(repoCommandDir, `${command}.ts`), 'utf-8')

      expect(content).not.toContain("@clack/prompts")
      expect(content).not.toContain("./internal/git")
      expect(content).not.toContain("./internal/github")
      expect(content).not.toContain("../../lib/process")
    }
  })

  test('keeps root CLI entrypoint from depending on repo internals directly', () => {
    const content = readFileSync(join(rootDir, 'src', 'index.ts'), 'utf-8')

    expect(content).toContain('./commands/repo/internal/register')
    expect(content).not.toContain('./commands/repo/internal/text')
    expect(content).not.toContain('repoInitAction')
    expect(content).not.toContain('repoStatusAction')
    expect(content).not.toContain('repoPushAction')
    expect(content).not.toContain('repoSyncAction')
  })

  test('does not expose repo-internal helpers from top-level command files', () => {
    const expected = {
      init: ['repoInitAction', 'RepoInitActionOptions'],
      push: ['repoPushAction', 'RepoPushActionOptions'],
      status: ['repoStatusAction', 'RepoStatusActionOptions'],
      sync: ['repoSyncAction', 'RepoSyncActionOptions'],
    }

    for (const [command, allowedExports] of Object.entries(expected)) {
      const content = readFileSync(join(repoCommandDir, `${command}.ts`), 'utf-8')
      const exports = Array.from(content.matchAll(/export(?:\s+type)?\s*{([\s\S]*?)}\s+from/g))
        .flatMap((match) => match[1]!.split(','))
        .map((name) => name.trim())
        .filter(Boolean)

      expect(new Set(exports)).toEqual(new Set(allowedExports))
    }
  })

  test('keeps repo shell helpers inside the repo module', () => {
    const repoGit = readFileSync(join(repoCommandDir, 'internal', 'git.ts'), 'utf-8')
    const repoToken = readFileSync(join(repoCommandDir, 'internal', 'github-token.ts'), 'utf-8')
    const repoOperations = readFileSync(join(repoCommandDir, 'internal', 'init-operations.ts'), 'utf-8')
    const repoProcess = readFileSync(join(repoCommandDir, 'internal', 'process.ts'), 'utf-8')

    expect(repoGit).toContain("from './process.js'")
    expect(repoToken).toContain("from './process.js'")
    expect(repoOperations).toContain("from './process.js'")
    expect(repoGit).not.toContain('../../../lib/process')
    expect(repoToken).not.toContain('../../../lib/process')
    expect(repoOperations).not.toContain('../../../lib/process')
    expect(repoProcess).toContain('input?: string')
    expect(repoProcess).toContain('timeout?: number')
  })

  test('keeps repo-specific text out of the shared i18n table', () => {
    const sharedI18n = readFileSync(join(rootDir, 'src', 'lib', 'i18n.ts'), 'utf-8')
    const repoText = readFileSync(join(repoCommandDir, 'internal', 'text.ts'), 'utf-8')

    expect(sharedI18n).not.toContain('repoMaintenanceQuestion')
    expect(sharedI18n).not.toContain('cmdRepo')
    expect(sharedI18n).not.toContain('repoInitProjectHint')
    expect(repoText).toContain('repoMaintenanceQuestion')
    expect(repoText).toContain('cmdRepo')
    expect(repoText).toContain('repoInitProjectHint')

    for (const file of ['init', 'push', 'status', 'sync']) {
      const content = readFileSync(join(repoCommandDir, 'internal', `${file}-runtime.ts`), 'utf-8')
      expect(content).not.toContain('../../../lib/i18n')
      expect(content).toContain("from './text.js'")
    }
  })

  test('keeps repo runtime modules on existing project resolution rules', () => {
    for (const command of ['init', 'push', 'status', 'sync']) {
      const content = readFileSync(join(repoCommandDir, 'internal', `${command}-runtime.ts`), 'utf-8')

      expect(content).toContain('resolveProjectDir')
      expect(content).toContain('options.projectDir ?? resolveProjectDir(options.project)')
    }
  })

  test('keeps create integration away from repo low-level internals', () => {
    const content = readFileSync(createCommandPath, 'utf-8')
    const repoImports = Array.from(content.matchAll(/import\(["'](\.\/repo\/[^"']+)["']\)|from ["'](\.\/repo\/[^"']+)["']/g))
      .map((match) => match[1] ?? match[2])

    expect(content).toContain('./repo/internal/create-integration')
    expect(repoImports).toEqual(['./repo/internal/create-integration.js'])
  })
})
