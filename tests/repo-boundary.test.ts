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

  test('keeps the upstream release workflow separate from repo experimental publishing', () => {
    const releaseWorkflowPath = join(rootDir, '.github', 'workflows', 'release.yml')
    const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf-8')
    const repoReleaseWorkflowPath = join(rootDir, '.github', 'workflows', 'repo-release.yml')
    const repoReleaseWorkflow = readFileSync(repoReleaseWorkflowPath, 'utf-8')

    expect(existsSync(releaseWorkflowPath)).toBe(true)
    expect(existsSync(repoReleaseWorkflowPath)).toBe(true)
    expect(releaseWorkflow).toContain('pnpm publish --provenance --access public --no-git-checks')
    expect(releaseWorkflow).toContain('NPM_TOKEN')
    expect(releaseWorkflow).not.toContain('fba-cli.tgz')
    expect(repoReleaseWorkflow).toContain('repo-v*')
    expect(repoReleaseWorkflow).toContain('fba-cli.tgz')
    expect(repoReleaseWorkflow).toContain('softprops/action-gh-release')
    expect(repoReleaseWorkflow).toContain('pnpm install --frozen-lockfile')
    expect(repoReleaseWorkflow).toContain('pnpm run typecheck')
    expect(repoReleaseWorkflow).toContain('pnpm run build')
    expect(repoReleaseWorkflow).not.toContain('pnpm publish')
    expect(repoReleaseWorkflow).not.toContain('NPM_TOKEN')
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

  test('keeps repo init pure planning helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'init-runtime.ts'), 'utf-8')
    const planning = readFileSync(join(repoCommandDir, 'internal', 'init.ts'), 'utf-8')

    expect(runtime).not.toContain('export function renderGitmodules')
    expect(runtime).not.toContain('export function upsertGitmodulesContent')
    expect(runtime).not.toContain('export function buildDefaultRemotePlan')
    expect(planning).toContain('export function renderGitmodules')
    expect(planning).toContain('export function upsertGitmodulesContent')
    expect(planning).toContain('export function buildDefaultRemotePlan')
  })

  test('keeps repo init operation helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'init-runtime.ts'), 'utf-8')
    const operations = readFileSync(join(repoCommandDir, 'internal', 'init-operations.ts'), 'utf-8')

    expect(runtime).not.toContain('function writeGitmodules')
    expect(runtime).not.toContain('async function ensureUnshallowed')
    expect(runtime).not.toContain('async function checkChildRepositoryRoots')
    expect(runtime).not.toContain('async function applyRepoInitPlan')
    expect(operations).toContain('export async function checkGitAvailable')
    expect(operations).toContain('export async function checkChildRepositoryRoots')
    expect(operations).toContain('export async function applyRepoInitPlan')
    expect(operations).toContain('export async function createLocalInitCommit')
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

  test('keeps repo runtime modules from exporting internal helpers', () => {
    const expected = {
      'init-runtime': ['repoInitAction', 'RepoInitActionOptions'],
      'push-runtime': ['repoPushAction', 'RepoPushActionOptions'],
      'status-runtime': ['repoStatusAction', 'RepoStatusActionOptions'],
      'sync-runtime': ['repoSyncAction', 'RepoSyncActionOptions'],
    }

    for (const [moduleName, allowedExports] of Object.entries(expected)) {
      const content = readFileSync(join(repoCommandDir, 'internal', `${moduleName}.ts`), 'utf-8')
      const exports = Array.from(content.matchAll(/export(?:\s+type)?\s+(?:interface\s+|type\s+|function\s+|async\s+function\s+)?([A-Za-z0-9_]+)/g))
        .map((match) => match[1]!)
        .filter((name) => name !== 'from')

      expect(new Set(exports)).toEqual(new Set(allowedExports))
    }
  })

  test('keeps repo runtime modules on existing project resolution rules', () => {
    for (const command of ['init', 'push', 'status', 'sync']) {
      const content = readFileSync(join(repoCommandDir, 'internal', `${command}-runtime.ts`), 'utf-8')

      expect(content).toContain('resolveProjectDir')
      expect(content).toContain('options.projectDir ?? resolveProjectDir(options.project)')
    }
  })

  test('keeps repo sync conflict helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'sync-runtime.ts'), 'utf-8')
    const conflicts = readFileSync(join(repoCommandDir, 'internal', 'sync-conflicts.ts'), 'utf-8')

    expect(runtime).not.toContain('export function mapConflictChoiceToGitSide')
    expect(runtime).not.toContain('async function handleConflict')
    expect(conflicts).toContain('export function mapConflictChoiceToGitSide')
    expect(conflicts).toContain('export async function handleConflict')
  })

  test('keeps repo sync prompt helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'sync-runtime.ts'), 'utf-8')
    const prompts = readFileSync(join(repoCommandDir, 'internal', 'sync-prompts.ts'), 'utf-8')

    expect(runtime).not.toContain('function getActionLabel')
    expect(runtime).not.toContain('async function promptSyncAction')
    expect(runtime).not.toContain('async function chooseUpstreamBranch')
    expect(prompts).toContain('export async function promptSyncAction')
    expect(prompts).toContain('export async function chooseUpstreamBranch')
  })

  test('keeps repo sync operation helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'sync-runtime.ts'), 'utf-8')
    const operations = readFileSync(join(repoCommandDir, 'internal', 'sync-operations.ts'), 'utf-8')

    expect(runtime).not.toContain('async function applySyncOperation')
    expect(runtime).not.toContain('async function handleMainRepositoryPointerChanges')
    expect(operations).toContain('export async function applySyncOperation')
    expect(operations).toContain('export async function handleMainRepositoryPointerChanges')
  })

  test('keeps repo sync inspection helpers outside the runtime module', () => {
    const runtime = readFileSync(join(repoCommandDir, 'internal', 'sync-runtime.ts'), 'utf-8')
    const inspection = readFileSync(join(repoCommandDir, 'internal', 'sync-inspection.ts'), 'utf-8')

    expect(runtime).not.toContain('async function inspectSyncRepository')
    expect(runtime).not.toContain('async function buildProjectSyncPlan')
    expect(runtime).not.toContain('async function inspectUpstreamTarget')
    expect(inspection).toContain('export async function inspectSyncRepository')
    expect(inspection).toContain('export async function buildProjectSyncPlan')
    expect(inspection).toContain('export async function inspectUpstreamTarget')
  })

  test('keeps repo status and push inspection helpers outside runtime modules', () => {
    const statusRuntime = readFileSync(join(repoCommandDir, 'internal', 'status-runtime.ts'), 'utf-8')
    const pushRuntime = readFileSync(join(repoCommandDir, 'internal', 'push-runtime.ts'), 'utf-8')
    const statusInspection = readFileSync(join(repoCommandDir, 'internal', 'status-inspection.ts'), 'utf-8')
    const pushInspection = readFileSync(join(repoCommandDir, 'internal', 'push-inspection.ts'), 'utf-8')

    expect(statusRuntime).not.toContain('async function inspectRepository')
    expect(statusRuntime).not.toContain('async function buildProjectStatus')
    expect(pushRuntime).not.toContain('async function inspectPushRepository')
    expect(pushRuntime).not.toContain('async function buildProjectPushPlan')
    expect(statusInspection).toContain('export async function buildProjectStatus')
    expect(pushInspection).toContain('export async function buildProjectPushPlan')
  })

  test('keeps create integration away from repo low-level internals', () => {
    const content = readFileSync(createCommandPath, 'utf-8')

    expect(content).toContain('./repo/internal/create-integration')
    expect(content).not.toContain('./repo/internal/git')
    expect(content).not.toContain('fullHistory')
  })
})
