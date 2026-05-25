import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import { run } from './process.js'
import { isDirectoryEmpty, readOptionalTextFile } from './files.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import {
  ensureRemote,
  checkoutNewBranchAtHead,
  getCurrentBranch,
  getMissingSubmoduleGitlinkPaths,
  getRemoteUrl,
  initSubmodules,
  initGitRepo,
  isGitRepoRoot,
  isShallowRepo,
  listLocalBranches,
  listRemoteBranches,
  unshallowRepo,
} from './git.js'
import { type GitHubClient } from './github.js'
import { type StrictProjectConfig } from './project.js'
import {
  createRepoInitSnapshot,
  restoreRepoInitSnapshot,
  type RepoInitSnapshot,
} from './transaction.js'
import {
  formatGitHubRepoInitError,
  upsertGitmodulesContent,
  type GitmodulesInput,
} from './init.js'
import { type RepoPlan } from './init-types.js'
import { formatErrorMessage } from './display.js'

function writeGitmodules(projectDir: string, input: GitmodulesInput): void {
  const gitmodulesPath = join(projectDir, '.gitmodules')
  const currentContent = readOptionalTextFile(gitmodulesPath) ?? ''
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

export async function initMissingChildRepositories(input: {
  projectDir: string
  config: StrictProjectConfig
  backendDir: string
  frontendDir: string
  gitmodules?: GitmodulesInput
  authToken?: string
}): Promise<'ok' | 'cancelled' | 'failed'> {
  const childRepos = [
    { path: input.config.backend_name, dir: input.backendDir },
    { path: input.config.frontend_name, dir: input.frontendDir },
  ]
  const childStates = await Promise.all(childRepos.map(async (child) => {
    const exists = existsSync(child.dir)
    const isRoot = exists ? await isGitRepoRoot(child.dir) : false
    return {
      ...child,
      exists,
      isRoot,
      isEmpty: exists ? isDirectoryEmpty(child.dir) : true,
    }
  }))
  const blockedNonEmpty = childStates
    .filter((child) => child.exists && !child.isRoot && !child.isEmpty)
    .map((child) => child.path)
  if (blockedNonEmpty.length > 0) {
    clack.log.error(chalk.red(rt('repoInitNonEmptyChildDirUnsupported', {
      paths: blockedNonEmpty.join(', '),
    })))
    return 'failed'
  }

  const uniqueMissingPaths = [...new Set(childStates
    .filter((child) => !child.exists || !child.isRoot)
    .map((child) => child.path))]

  if (uniqueMissingPaths.length === 0) return 'ok'

  if (!(await isGitRepoRoot(input.projectDir))) {
    clack.log.error(chalk.red(rt('repoInitMissingChildrenMainGitRequired')))
    return 'failed'
  }

  const shouldInit = await clack.confirm({
    message: rt('repoInitMissingChildrenQuestion', { paths: uniqueMissingPaths.join(', ') }),
    initialValue: true,
  })
  if (clack.isCancel(shouldInit) || !shouldInit) return 'cancelled'

  const missingGitlinks = await getMissingSubmoduleGitlinkPaths(input.projectDir, uniqueMissingPaths)
  if (missingGitlinks === null || missingGitlinks.length > 0) {
    clack.log.error(chalk.red(rt('repoInitMissingChildrenGitlinkMissing', {
      paths: (missingGitlinks ?? uniqueMissingPaths).join(', '),
    })))
    return 'failed'
  }

  if (input.gitmodules) {
    try {
      writeGitmodules(input.projectDir, input.gitmodules)
    } catch (error) {
      clack.log.error(chalk.red(formatErrorMessage(error)))
      clack.log.error(chalk.red(rt('repoInitMissingChildrenFailed')))
      return 'failed'
    }
  }

  let ok = false
  try {
    ok = await initSubmodules(input.projectDir, uniqueMissingPaths, { authToken: input.authToken })
  } catch (error) {
    clack.log.error(chalk.red(formatErrorMessage(error)))
    ok = false
  }
  if (!ok) {
    clack.log.error(chalk.red(rt('repoInitMissingChildrenFailed')))
    return 'failed'
  }

  return 'ok'
}

async function ensureUnshallowed(dir: string, authToken?: string): Promise<void> {
  if (await isShallowRepo(dir)) {
    const ok = await unshallowRepo(dir, { authToken })
    if (!ok) throw new Error(`Failed to fetch full git history for ${dir}`)
  }
}

async function prepareExistingChildOriginBeforeUnshallow(input: {
  dir: string
  item: RepoPlan['backend'] | RepoPlan['frontend']
}): Promise<void> {
  if (input.item.action === 'create') return
  if (await getRemoteUrl(input.dir, 'origin')) return
  await ensureRemote(input.dir, 'origin', input.item.ref.normalizedUrl)
}

function chooseChildBranch(remoteBranches: string[]): string | null {
  if (remoteBranches.includes('main')) return 'main'
  if (remoteBranches.includes('master')) return 'master'
  return remoteBranches[0] ?? 'main'
}

function chooseAvailableLocalBranch(preferredBranch: string, localBranches: string[]): string {
  if (!localBranches.includes(preferredBranch)) return preferredBranch

  const fallback = `fba-repo-${preferredBranch}`
  if (!localBranches.includes(fallback)) return fallback

  for (let index = 2; ; index += 1) {
    const candidate = `${fallback}-${index}`
    if (!localBranches.includes(candidate)) return candidate
  }
}

async function ensureChildBranch(dir: string): Promise<void> {
  if (await getCurrentBranch(dir)) return

  const preferredBranch = chooseChildBranch(await listRemoteBranches(dir, 'origin'))
  if (!preferredBranch) return

  const branch = chooseAvailableLocalBranch(preferredBranch, await listLocalBranches(dir))
  const ok = await checkoutNewBranchAtHead(dir, branch)
  if (!ok) throw new Error(`Failed to checkout ${branch} in ${dir}`)
}

async function createRepositoryIfNeeded(input: {
  github: GitHubClient
  item: RepoPlan[keyof RepoPlan]
  userLogin: string
  createdRoles: Set<string>
}): Promise<void> {
  if (input.item.action !== 'create') return
  if (input.createdRoles.has(input.item.role)) return

  try {
    await input.github.createRepository({
      owner: input.item.ref.owner,
      name: input.item.ref.repo,
      private: input.item.private,
      authenticatedUser: input.userLogin,
    })
    input.createdRoles.add(input.item.role)
  } catch (error) {
    clack.log.error(chalk.red(formatGitHubRepoInitError(error)))
    throw error
  }
}

async function prepareChildOrigin(input: {
  dir: string
  item: RepoPlan['backend'] | RepoPlan['frontend']
  github: GitHubClient
  userLogin: string
  createdRoles: Set<string>
}): Promise<void> {
  await createRepositoryIfNeeded({
    github: input.github,
    item: input.item,
    userLogin: input.userLogin,
    createdRoles: input.createdRoles,
  })
  await ensureRemote(input.dir, 'origin', input.item.ref.normalizedUrl)
}

async function prepareExistingChildOrigin(input: {
  dir: string
  item: RepoPlan['backend'] | RepoPlan['frontend']
}): Promise<void> {
  if (input.item.action === 'create') return
  await ensureRemote(input.dir, 'origin', input.item.ref.normalizedUrl)
}

export async function applyRepoInitPlan(input: {
  projectDir: string
  backendDir: string
  frontendDir: string
  config: StrictProjectConfig
  github: GitHubClient
  userLogin: string
  plan: RepoPlan
  snapshot?: RepoInitSnapshot
  authToken?: string
}): Promise<void> {
  const snapshot = input.snapshot ?? await createRepoInitSnapshot({
    projectDir: input.projectDir,
    backendDir: input.backendDir,
    frontendDir: input.frontendDir,
  })

  try {
    const createdRoles = new Set<string>()
    await prepareExistingChildOriginBeforeUnshallow({
      dir: input.backendDir,
      item: input.plan.backend,
    })
    await prepareExistingChildOriginBeforeUnshallow({
      dir: input.frontendDir,
      item: input.plan.frontend,
    })
    await ensureUnshallowed(input.backendDir, input.authToken)
    await ensureUnshallowed(input.frontendDir, input.authToken)

    await prepareExistingChildOrigin({
      dir: input.backendDir,
      item: input.plan.backend,
    })
    await prepareExistingChildOrigin({
      dir: input.frontendDir,
      item: input.plan.frontend,
    })

    await ensureChildBranch(input.backendDir)
    await ensureChildBranch(input.frontendDir)

    for (const item of Object.values(input.plan)) {
      await createRepositoryIfNeeded({
        github: input.github,
        item,
        userLogin: input.userLogin,
        createdRoles,
      })
    }

    await prepareChildOrigin({
      dir: input.backendDir,
      item: input.plan.backend,
      github: input.github,
      userLogin: input.userLogin,
      createdRoles,
    })
    await prepareChildOrigin({
      dir: input.frontendDir,
      item: input.plan.frontend,
      github: input.github,
      userLogin: input.userLogin,
      createdRoles,
    })

    await ensureRemote(input.backendDir, 'upstream', OFFICIAL_BACKEND_REPO)
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
    try {
      await restoreRepoInitSnapshot(snapshot)
    } catch (rollbackError) {
      clack.log.warn(chalk.yellow(rt('repoInitRollbackFailed')))
      clack.log.warn(chalk.yellow(formatErrorMessage(rollbackError)))
    }
    clack.log.error(chalk.red(rt('repoInitApplyFailed')))
    clack.log.info(rt('repoInitRetryHint'))
    throw error
  }
}

export async function createLocalInitCommit(
  projectDir: string,
  config: StrictProjectConfig,
): Promise<boolean> {
  const paths = ['.gitmodules', config.backend_name, config.frontend_name]
  const stagedResult = await run('git', ['diff', '--cached', '--name-only', '-z', '--', ...paths], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (stagedResult.exitCode !== 0) return false
  const stagedPaths = stagedResult.stdout.split('\0').filter(Boolean)
  if (stagedPaths.length > 0) return false

  const addResult = await run('git', ['add', ...paths], {
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
      ...paths,
    ],
    {
      cwd: projectDir,
      spinner: true,
      label: rt('repoInitCreatingCommit'),
    },
  )
  if (commitResult.exitCode === 0) return true

  await run('git', ['reset', '--', ...paths], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return false
}
