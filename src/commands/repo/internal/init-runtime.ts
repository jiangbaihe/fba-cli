import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  resolveProjectDir,
} from '../../../lib/config.js'
import {
  createGitHubClient,
  type GitHubRepoRef,
} from './github.js'
import { resolveGitHubToken } from './github-token.js'
import {
  readStrictProjectConfig,
  type StrictProjectConfig,
} from './project.js'
import {
  applyRepoInitPlan,
  checkChildRepositoryRoots,
  checkGitAvailable,
  createLocalInitCommit,
  initMissingChildRepositories,
} from './init-operations.js'
import { rt } from './text.js'
import {
  buildDefaultRemotePlan,
  formatGitHubRepoInitError,
  isGitHubHttpsUrl,
  normalizeRemotePlan,
  preferExistingRemotePlan,
  resolvePromptTextValue,
  tryNormalizeRemotePlan,
  validateDistinctRemotePlan,
  validateGitHubOwnerName,
  type NormalizedRemotePlan,
  type RemotePlan,
} from './init.js'
import {
  type RepoPlan,
  type RepoPlanItem,
  type RepoRole,
} from './init-types.js'
import {
  createRepoInitSnapshot,
  restoreRepoInitSnapshot,
} from './transaction.js'
import {
  getCurrentBranch,
  getRemoteUrl,
  isGitRepoRoot,
} from './git.js'
import { readOptionalTextFile } from './files.js'
import { installRepoInitRollbackSignalHandlers } from './signals.js'
import { parseGitmodules } from './status.js'
import { formatErrorMessage } from './display.js'

export interface RepoInitActionOptions {
  project?: string
  projectDir?: string
}

function isCancelled(value: unknown): boolean {
  return clack.isCancel(value)
}

function cancelRepoInit(message = rt('repoInitCancelled')): void {
  clack.cancel(chalk.yellow(message))
}

function getRoleLabel(role: RepoRole): string {
  switch (role) {
    case 'main':
      return rt('repoInitRoleMain')
    case 'backend':
      return rt('repoInitRoleBackend')
    case 'frontend':
      return rt('repoInitRoleFrontend')
  }
}

function formatRepoRef(ref: GitHubRepoRef): string {
  return `${ref.owner}/${ref.repo}`
}

function getPlanItem(plan: RepoPlan, role: RepoRole): RepoPlanItem {
  return plan[role]
}

function renderDefaultRemoteMessage(defaults: RemotePlan): string {
  return [
    rt('repoInitUseDefaultRemotes'),
    `${rt('repoInitRoleMain')}: ${defaults.main}`,
    `${rt('repoInitRoleBackend')}: ${defaults.backend}`,
    `${rt('repoInitRoleFrontend')}: ${defaults.frontend}`,
  ].join('\n')
}

function renderPlanNote(plan: RepoPlan, config: StrictProjectConfig): string {
  const repoLines = (['main', 'backend', 'frontend'] as const).map((role) => {
    const item = getPlanItem(plan, role)
    const action =
      item.action === 'create'
        ? `${rt('repoInitCreateRepo')} (${item.private ? rt('repoInitPrivate') : rt('repoInitPublic')})`
        : rt('repoInitReuseRepo')
    return `${getRoleLabel(role)}: ${action} ${formatRepoRef(item.ref)}`
  })

  return [
    ...repoLines,
    '',
    rt('repoInitLocalChanges'),
    `- ${rt('repoInitLocalBackendRemotes')}: ${config.backend_name}`,
    `- ${rt('repoInitLocalFrontendRemotes')}: ${config.frontend_name}`,
    `- ${rt('repoInitLocalFullHistory')}`,
    `- ${rt('repoInitLocalGitmodules')}`,
    `- ${rt('repoInitLocalMainGit')}`,
    `- ${rt('repoInitLocalCommitPrompt')}`,
    '',
    rt('repoInitNoPush'),
  ].join('\n')
}

function getGitmoduleUrl(content: string | null, expectedPath: string): string | null {
  if (!content) return null
  const entries = parseGitmodules(content)
  const entry = entries[expectedPath] ?? Object.values(entries).find((item) => item.path === expectedPath)
  return entry?.url ?? null
}

async function needsChildSubmoduleInit(dir: string): Promise<boolean> {
  return !existsSync(dir) || !(await isGitRepoRoot(dir))
}

async function buildInitialRemoteDefaults(input: {
  projectDir: string
  backendDir: string
  frontendDir: string
  owner: string
  config: StrictProjectConfig
}): Promise<RemotePlan> {
  const generated = buildDefaultRemotePlan({
    owner: input.owner,
    projectName: input.config.name,
    backendName: input.config.backend_name,
    frontendName: input.config.frontend_name,
  })
  const gitmodulesPath = join(input.projectDir, '.gitmodules')
  const gitmodulesContent = readOptionalTextFile(gitmodulesPath)

  const [mainIsRoot, backendIsRoot, frontendIsRoot] = await Promise.all([
    isGitRepoRoot(input.projectDir),
    isGitRepoRoot(input.backendDir),
    isGitRepoRoot(input.frontendDir),
  ])
  const [mainOrigin, backendOrigin, frontendOrigin] = await Promise.all([
    mainIsRoot ? getRemoteUrl(input.projectDir, 'origin') : null,
    backendIsRoot ? getRemoteUrl(input.backendDir, 'origin') : null,
    frontendIsRoot ? getRemoteUrl(input.frontendDir, 'origin') : null,
  ])

  return preferExistingRemotePlan({
    generated,
    mainOrigin,
    backendOrigin,
    frontendOrigin,
    gitmodulesBackendUrl: getGitmoduleUrl(gitmodulesContent, input.config.backend_name),
    gitmodulesFrontendUrl: getGitmoduleUrl(gitmodulesContent, input.config.frontend_name),
  })
}

async function promptRemoteUrl(role: RepoRole, defaultValue: string): Promise<string | null> {
  const value = await clack.text({
    message: `${getRoleLabel(role)} ${rt('repoInitRemoteUrl')}`,
    defaultValue,
    placeholder: defaultValue,
    validate: (input) => {
      const candidate = resolvePromptTextValue(input, defaultValue)
      if (!candidate) return rt('repoInitRemoteRequired')
      return isGitHubHttpsUrl(candidate) ? undefined : rt('repoInitOnlyGithubHttps')
    },
  })

  if (isCancelled(value)) {
    cancelRepoInit()
    return null
  }

  return resolvePromptTextValue(String(value), defaultValue)
}

async function promptRemotePlan(defaults: RemotePlan): Promise<NormalizedRemotePlan | null> {
  const useDefaults = await clack.confirm({
    message: renderDefaultRemoteMessage(defaults),
    initialValue: true,
  })

  if (isCancelled(useDefaults)) {
    cancelRepoInit()
    return null
  }

  if (useDefaults) {
    const normalized = tryNormalizeRemotePlan(defaults)
    if (normalized.ok) {
      const distinctError = validateDistinctRemotePlan(normalized.plan)
      if (!distinctError) return normalized.plan
      clack.log.warn(chalk.yellow(distinctError))
    } else {
      clack.log.warn(chalk.yellow(normalized.error))
    }
  }

  for (;;) {
    const main = await promptRemoteUrl('main', defaults.main)
    if (!main) return null
    const backend = await promptRemoteUrl('backend', defaults.backend)
    if (!backend) return null
    const frontend = await promptRemoteUrl('frontend', defaults.frontend)
    if (!frontend) return null

    const normalized = normalizeRemotePlan({ main, backend, frontend })
    const distinctError = validateDistinctRemotePlan(normalized)
    if (!distinctError) return normalized

    clack.log.error(chalk.red(distinctError))
  }
}

async function planRemoteState(
  github: ReturnType<typeof createGitHubClient>,
  role: RepoRole,
  ref: GitHubRepoRef,
  options: { blockedCreatePath?: string } = {},
): Promise<RepoPlanItem | null> {
  let repository: Awaited<ReturnType<typeof github.getRepository>>
  try {
    repository = await github.getRepository(ref.owner, ref.repo)
  } catch (error) {
    clack.log.error(chalk.red(formatGitHubRepoInitError(error)))
    throw error
  }
  if (repository) {
    const useExisting = await clack.confirm({
      message: `${getRoleLabel(role)} ${formatRepoRef(ref)} ${rt('repoInitRepoExistsUse')}`,
      initialValue: true,
    })
    if (isCancelled(useExisting)) {
      cancelRepoInit()
      return null
    }
    if (!useExisting) {
      cancelRepoInit(rt('repoInitRefusedRepoHint'))
      return null
    }
    return { role, ref, action: 'reuse', private: Boolean(repository.private) }
  }

  if (options.blockedCreatePath) {
    clack.log.error(chalk.red(rt('repoInitMissingChildrenNewRepoUnsupported', {
      paths: options.blockedCreatePath,
    })))
    return null
  }

  const createMissing = await clack.confirm({
    message: `${getRoleLabel(role)} ${formatRepoRef(ref)} ${rt('repoInitRepoMissingCreate')}`,
    initialValue: true,
  })
  if (isCancelled(createMissing)) {
    cancelRepoInit()
    return null
  }
  if (!createMissing) {
    cancelRepoInit(rt('repoInitRefusedRepoHint'))
    return null
  }

  const visibility = await clack.select({
    message: `${rt('repoInitVisibilityFor')} ${formatRepoRef(ref)}`,
    initialValue: 'public',
    options: [
      { value: 'public', label: rt('repoInitPublic') },
      { value: 'private', label: rt('repoInitPrivate') },
    ],
  })

  if (isCancelled(visibility)) {
    cancelRepoInit()
    return null
  }

  return {
    role,
    ref,
    action: 'create',
    private: visibility === 'private',
  }
}

async function buildRepoPlan(
  github: ReturnType<typeof createGitHubClient>,
  remotes: NormalizedRemotePlan,
  blockedChildCreates: Partial<Record<'backend' | 'frontend', string>> = {},
): Promise<RepoPlan | null> {
  const main = await planRemoteState(github, 'main', remotes.main)
  if (!main) return null
  const backend = await planRemoteState(github, 'backend', remotes.backend, {
    blockedCreatePath: blockedChildCreates.backend,
  })
  if (!backend) return null
  const frontend = await planRemoteState(github, 'frontend', remotes.frontend, {
    blockedCreatePath: blockedChildCreates.frontend,
  })
  if (!frontend) return null

  return { main, backend, frontend }
}

async function maybeCreateLocalCommit(
  projectDir: string,
  config: StrictProjectConfig,
): Promise<void> {
  if (!(await getCurrentBranch(projectDir))) {
    clack.log.warn(chalk.yellow(rt('repoInitMainDetachedCommitSkipped')))
    return
  }

  const createCommit = await clack.confirm({
    message: rt('repoInitCommitQuestion'),
    initialValue: false,
  })

  if (isCancelled(createCommit)) return
  if (!createCommit) return

  const committed = await createLocalInitCommit(projectDir, config)
  if (!committed) {
    clack.log.warn(chalk.yellow(rt('repoInitCommitFailedHint')))
  }
}

async function restoreSnapshotForInit(
  snapshot: Awaited<ReturnType<typeof createRepoInitSnapshot>>,
): Promise<boolean> {
  try {
    await restoreRepoInitSnapshot(snapshot)
    return true
  } catch (error) {
    clack.log.warn(chalk.yellow(rt('repoInitRollbackFailed')))
    clack.log.warn(chalk.yellow(formatErrorMessage(error)))
    return false
  }
}

export async function repoInitAction(options: RepoInitActionOptions = {}): Promise<boolean> {
  const projectDir = options.projectDir ?? resolveProjectDir(options.project)
  if (!projectDir || !existsSync(join(projectDir, '.fba.json'))) {
    clack.log.error(chalk.red(rt('useNotFbaProject')))
    clack.log.info(rt('repoInitProjectHint'))
    return false
  }

  let config: StrictProjectConfig
  try {
    config = readStrictProjectConfig(projectDir)
  } catch (error) {
    clack.log.error(chalk.red(formatErrorMessage(error)))
    return false
  }

  const backendDir = join(projectDir, config.backend_name)
  const frontendDir = join(projectDir, config.frontend_name)

  clack.intro(chalk.bgCyan(' fba-cli repo init '))
  clack.log.info(`${config.name} ${chalk.dim(projectDir)}`)

  const confirmedProject = await clack.confirm({
    message: `${rt('repoInitConfirmProject')} ${config.name} (${projectDir})?`,
    initialValue: true,
  })
  if (isCancelled(confirmedProject)) {
    cancelRepoInit()
    return false
  }
  if (!confirmedProject) {
    cancelRepoInit()
    return false
  }

  if (!(await checkGitAvailable())) {
    clack.log.error(chalk.red(rt('repoInitGitMissing')))
    return false
  }
  let snapshot: Awaited<ReturnType<typeof createRepoInitSnapshot>>
  try {
    snapshot = await createRepoInitSnapshot({ projectDir, backendDir, frontendDir })
  } catch (error) {
    clack.log.error(chalk.red(formatErrorMessage(error)))
    clack.log.info(rt('repoInitRetryHint'))
    return false
  }
  const disposeRollbackSignalHandlers = installRepoInitRollbackSignalHandlers({
    snapshot,
    warn: (message) => clack.log.warn(chalk.yellow(message)),
    rollbackFailedMessage: rt('repoInitRollbackFailed'),
  })
  const rollbackAndCancel = async (message = rt('repoInitCancelled')): Promise<false> => {
    await restoreSnapshotForInit(snapshot)
    disposeRollbackSignalHandlers()
    cancelRepoInit(message)
    return false
  }
  const rollbackAndFail = async (): Promise<false> => {
    await restoreSnapshotForInit(snapshot)
    disposeRollbackSignalHandlers()
    return false
  }

  const discoveredToken = await resolveGitHubToken()
  if (discoveredToken) {
    clack.log.info(`${rt('repoInitTokenDetected')}: ${discoveredToken.source}`)
  }

  const tokenFromPrompt = discoveredToken ? null : await clack.password({
    message: rt('repoInitGithubToken'),
    validate: (value) => value?.trim() ? undefined : rt('repoInitTokenRequired'),
  })
  if (isCancelled(tokenFromPrompt)) {
    return rollbackAndCancel()
  }

  const token = discoveredToken?.token || String(tokenFromPrompt).trim()
  const github = createGitHubClient(token)
  let user: Awaited<ReturnType<typeof github.getAuthenticatedUser>>
  try {
    user = await github.getAuthenticatedUser()
  } catch (error) {
    clack.log.error(chalk.red(formatGitHubRepoInitError(error)))
    return rollbackAndFail()
  }

  const owner = await clack.text({
    message: rt('repoInitGithubOwner'),
    defaultValue: user.login,
    placeholder: user.login,
    validate: (value) => validateGitHubOwnerName(resolvePromptTextValue(value, user.login)),
  })
  if (isCancelled(owner)) {
    return rollbackAndCancel()
  }

  const defaults = await buildInitialRemoteDefaults({
    projectDir,
    backendDir,
    frontendDir,
    owner: resolvePromptTextValue(String(owner), user.login),
    config,
  })

  const remotePlan = await promptRemotePlan(defaults)
  if (!remotePlan) return rollbackAndFail()

  const [backendNeedsSubmoduleInit, frontendNeedsSubmoduleInit] = await Promise.all([
    needsChildSubmoduleInit(backendDir),
    needsChildSubmoduleInit(frontendDir),
  ])
  let repoPlan: RepoPlan | null
  try {
    repoPlan = await buildRepoPlan(github, remotePlan, {
      backend: backendNeedsSubmoduleInit ? config.backend_name : undefined,
      frontend: frontendNeedsSubmoduleInit ? config.frontend_name : undefined,
    })
  } catch {
    return rollbackAndFail()
  }
  if (!repoPlan) return rollbackAndFail()

  const confirmedApply = await clack.confirm({
    message: renderPlanNote(repoPlan, config),
    initialValue: true,
  })
  if (isCancelled(confirmedApply)) {
    return rollbackAndCancel()
  }
  if (!confirmedApply) {
    return rollbackAndCancel()
  }

  const childInitResult = await initMissingChildRepositories({
    projectDir,
    config,
    backendDir,
    frontendDir,
    gitmodules: {
      backendName: config.backend_name,
      backendUrl: repoPlan.backend.ref.normalizedUrl,
      frontendName: config.frontend_name,
      frontendUrl: repoPlan.frontend.ref.normalizedUrl,
    },
    authToken: token,
  })
  if (childInitResult !== 'ok') {
    if (childInitResult === 'failed') {
      await restoreSnapshotForInit(snapshot)
      disposeRollbackSignalHandlers()
      clack.log.info(rt('repoInitRetryHint'))
      return false
    }
    return rollbackAndCancel()
  }
  if (!existsSync(backendDir)) {
    clack.log.error(chalk.red(`${rt('backendDirNotFound')}: ${backendDir}`))
    return rollbackAndFail()
  }
  if (!existsSync(frontendDir)) {
    clack.log.error(chalk.red(`${rt('frontendDirNotFound')}: ${frontendDir}`))
    return rollbackAndFail()
  }
  if (!(await checkChildRepositoryRoots({ backendDir, frontendDir }))) {
    clack.log.info(rt('repoInitChildGitRootHint'))
    return rollbackAndFail()
  }

  try {
    await applyRepoInitPlan({
      projectDir,
      backendDir,
      frontendDir,
      config,
      github,
      userLogin: user.login,
      plan: repoPlan,
      snapshot,
      authToken: token,
    })
  } catch {
    disposeRollbackSignalHandlers()
    return false
  }
  disposeRollbackSignalHandlers()

  await maybeCreateLocalCommit(projectDir, config)

  clack.note([
    'git status',
    `git -C ${config.backend_name} status`,
    `git -C ${config.frontend_name} status`,
  ].join('\n'), rt('repoInitNextSteps'))
  clack.outro(chalk.green(rt('repoInitComplete')))
  return true
}
