import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import { run } from './process.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import {
  ensureRemote,
  initGitRepo,
  isGitRepoRoot,
  isShallowRepo,
  unshallowRepo,
} from './git.js'
import { type GitHubClient } from './github.js'
import { type StrictProjectConfig } from './project.js'
import {
  createRepoInitSnapshot,
  restoreRepoInitSnapshot,
} from './transaction.js'
import {
  formatGitHubRepoInitError,
  upsertGitmodulesContent,
  type GitmodulesInput,
} from './init.js'
import { type RepoPlan } from './init-types.js'

function writeGitmodules(projectDir: string, input: GitmodulesInput): void {
  const gitmodulesPath = join(projectDir, '.gitmodules')
  const currentContent = existsSync(gitmodulesPath)
    ? readFileSync(gitmodulesPath, 'utf-8')
    : ''
  writeFileSync(gitmodulesPath, upsertGitmodulesContent(currentContent, input), 'utf-8')
}

export async function checkGitAvailable(): Promise<boolean> {
  const result = await run('git', ['--version'], {
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}

export async function checkChildRepositoryRoots(input: {
  backendDir: string
  frontendDir: string
}): Promise<boolean> {
  const [backendRoot, frontendRoot] = await Promise.all([
    isGitRepoRoot(input.backendDir),
    isGitRepoRoot(input.frontendDir),
  ])

  if (!backendRoot) {
    clack.log.error(chalk.red(`${rt('repoInitRoleBackend')} ${rt('repoInitChildGitRootRequired')}: ${input.backendDir}`))
  }
  if (!frontendRoot) {
    clack.log.error(chalk.red(`${rt('repoInitRoleFrontend')} ${rt('repoInitChildGitRootRequired')}: ${input.frontendDir}`))
  }

  return backendRoot && frontendRoot
}

async function ensureUnshallowed(dir: string): Promise<void> {
  if (await isShallowRepo(dir)) {
    const ok = await unshallowRepo(dir)
    if (!ok) throw new Error(`Failed to fetch full git history: ${dir}`)
  }
}

export async function applyRepoInitPlan(input: {
  projectDir: string
  backendDir: string
  frontendDir: string
  config: StrictProjectConfig
  github: GitHubClient
  userLogin: string
  plan: RepoPlan
}): Promise<void> {
  const snapshot = await createRepoInitSnapshot({
    projectDir: input.projectDir,
    backendDir: input.backendDir,
    frontendDir: input.frontendDir,
  })

  try {
    await ensureUnshallowed(input.backendDir)
    await ensureUnshallowed(input.frontendDir)

    for (const item of Object.values(input.plan)) {
      if (item.action !== 'create') continue
      try {
        await input.github.createRepository({
          owner: item.ref.owner,
          name: item.ref.repo,
          private: item.private,
          authenticatedUser: input.userLogin,
        })
      } catch (error) {
        clack.log.error(chalk.red(formatGitHubRepoInitError(error)))
        throw error
      }
    }

    await ensureRemote(input.backendDir, 'origin', input.plan.backend.ref.normalizedUrl)
    await ensureRemote(input.backendDir, 'upstream', OFFICIAL_BACKEND_REPO)
    await ensureRemote(input.frontendDir, 'origin', input.plan.frontend.ref.normalizedUrl)
    await ensureRemote(input.frontendDir, 'upstream', OFFICIAL_FRONTEND_REPO)

    if (!(await isGitRepoRoot(input.projectDir))) {
      const initialized = await initGitRepo(input.projectDir, 'main')
      if (!initialized) throw new Error(`Failed to initialize git repository: ${input.projectDir}`)
    }
    await ensureRemote(input.projectDir, 'origin', input.plan.main.ref.normalizedUrl)

    writeGitmodules(input.projectDir, {
      backendName: input.config.backend_name,
      backendUrl: input.plan.backend.ref.normalizedUrl,
      frontendName: input.config.frontend_name,
      frontendUrl: input.plan.frontend.ref.normalizedUrl,
    })
  } catch (error) {
    await restoreRepoInitSnapshot(snapshot)
    clack.log.error(chalk.red(rt('repoInitApplyFailed')))
    clack.log.info(rt('repoInitRetryHint'))
    throw error
  }
}

export async function createLocalInitCommit(
  projectDir: string,
  config: StrictProjectConfig,
): Promise<boolean> {
  const addResult = await run('git', ['add', '.gitmodules', config.backend_name, config.frontend_name], {
    cwd: projectDir,
    spinner: true,
    label: rt('repoInitStagingCommit'),
  })
  if (addResult.exitCode !== 0) return false

  const commitResult = await run(
    'git',
    [
      'commit',
      '-m',
      'chore: initialize repository remotes',
      '--',
      '.gitmodules',
      config.backend_name,
      config.frontend_name,
    ],
    {
      cwd: projectDir,
      spinner: true,
      label: rt('repoInitCreatingCommit'),
    },
  )
  return commitResult.exitCode === 0
}
