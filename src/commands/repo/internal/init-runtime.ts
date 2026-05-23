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
} from './init-operations.js'
import { rt } from './text.js'
import {
  buildDefaultRemotePlan,
  formatGitHubRepoInitError,
  isGitHubHttpsUrl,
  normalizeRemotePlan,
  resolvePromptTextValue,
  tryNormalizeRemotePlan,
  validateGitHubOwnerName,
  type NormalizedRemotePlan,
  type RemotePlan,
} from './init.js'
import {
  type RepoPlan,
  type RepoPlanItem,
  type RepoRole,
} from './init-types.js'

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
    if (normalized.ok) return normalized.plan
    clack.log.warn(chalk.yellow(normalized.error))
  }

  const main = await promptRemoteUrl('main', defaults.main)
  if (!main) return null
  const backend = await promptRemoteUrl('backend', defaults.backend)
  if (!backend) return null
  const frontend = await promptRemoteUrl('frontend', defaults.frontend)
  if (!frontend) return null

  return normalizeRemotePlan({ main, backend, frontend })
}

async function planRemoteState(
  github: ReturnType<typeof createGitHubClient>,
  role: RepoRole,
  ref: GitHubRepoRef,
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
): Promise<RepoPlan | null> {
  const main = await planRemoteState(github, 'main', remotes.main)
  if (!main) return null
  const backend = await planRemoteState(github, 'backend', remotes.backend)
  if (!backend) return null
  const frontend = await planRemoteState(github, 'frontend', remotes.frontend)
  if (!frontend) return null

  return { main, backend, frontend }
}

async function maybeCreateLocalCommit(
  projectDir: string,
  config: StrictProjectConfig,
): Promise<void> {
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
    clack.log.error(chalk.red(error instanceof Error ? error.message : String(error)))
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

  if (!existsSync(backendDir)) {
    clack.log.error(chalk.red(`${rt('backendDirNotFound')}: ${backendDir}`))
    return false
  }
  if (!existsSync(frontendDir)) {
    clack.log.error(chalk.red(`${rt('frontendDirNotFound')}: ${frontendDir}`))
    return false
  }
  if (!(await checkGitAvailable())) {
    clack.log.error(chalk.red(rt('repoInitGitMissing')))
    return false
  }
  if (!(await checkChildRepositoryRoots({ backendDir, frontendDir }))) {
    clack.log.info(rt('repoInitChildGitRootHint'))
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
    cancelRepoInit()
    return false
  }

  const token = discoveredToken?.token || String(tokenFromPrompt)
  const github = createGitHubClient(token)
  let user: Awaited<ReturnType<typeof github.getAuthenticatedUser>>
  try {
    user = await github.getAuthenticatedUser()
  } catch (error) {
    clack.log.error(chalk.red(formatGitHubRepoInitError(error)))
    return false
  }

  const owner = await clack.text({
    message: rt('repoInitGithubOwner'),
    defaultValue: user.login,
    placeholder: user.login,
    validate: (value) => validateGitHubOwnerName(resolvePromptTextValue(value, user.login)),
  })
  if (isCancelled(owner)) {
    cancelRepoInit()
    return false
  }

  const defaults = buildDefaultRemotePlan({
    owner: resolvePromptTextValue(String(owner), user.login),
    projectName: config.name,
    backendName: config.backend_name,
    frontendName: config.frontend_name,
  })

  const remotePlan = await promptRemotePlan(defaults)
  if (!remotePlan) return false

  let repoPlan: RepoPlan | null
  try {
    repoPlan = await buildRepoPlan(github, remotePlan)
  } catch {
    return false
  }
  if (!repoPlan) return false

  const confirmedApply = await clack.confirm({
    message: renderPlanNote(repoPlan, config),
    initialValue: true,
  })
  if (isCancelled(confirmedApply)) {
    cancelRepoInit()
    return false
  }
  if (!confirmedApply) {
    cancelRepoInit()
    return false
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
    })
  } catch {
    return false
  }

  await maybeCreateLocalCommit(projectDir, config)

  clack.note([
    'git status',
    `git -C ${config.backend_name} status`,
    `git -C ${config.frontend_name} status`,
  ].join('\n'), rt('repoInitNextSteps'))
  clack.outro(chalk.green(rt('repoInitComplete')))
  return true
}
