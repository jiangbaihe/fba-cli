import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import {
  fetchRemote,
  getAheadBehind,
  getCurrentBranch,
  getPorcelainStatus,
  getRemoteBranchRef,
  getRemoteUrl,
  isGitRepoRoot,
  isShallowRepo,
  listRemoteBranches,
} from './git.js'
import { readStrictProjectConfig } from './project.js'
import { assessGitmodules } from './status.js'
import {
  buildSyncPlan,
  convertGitmodulesChecksToSyncIssues,
  type SyncRepoRole,
  type SyncRepositoryProbe,
  type UpstreamSyncTarget,
} from './sync.js'

export interface ProjectSyncPlan {
  config: ReturnType<typeof readStrictProjectConfig>
  probes: Record<SyncRepoRole, SyncRepositoryProbe>
  precheck: ReturnType<typeof buildSyncPlan>
}

export interface BuildProjectSyncPlanOptions {
  mainProbe?: SyncRepositoryProbe
}

export interface UpstreamRuntimeTarget extends UpstreamSyncTarget {
  fetchOk: boolean
}

export function getRoleLabel(role: SyncRepoRole): string {
  if (role === 'main') return rt('repoInitRoleMain')
  if (role === 'backend') return rt('repoInitRoleBackend')
  return rt('repoInitRoleFrontend')
}

export async function inspectSyncRepository(input: {
  role: SyncRepoRole
  label: string
  dir: string
  expectedUpstreamUrl?: string
}): Promise<SyncRepositoryProbe> {
  const exists = existsSync(input.dir)
  if (!exists) {
    return {
      role: input.role,
      label: input.label,
      dir: input.dir,
      exists,
      isGitRoot: false,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      expectedUpstreamUrl: input.expectedUpstreamUrl,
      porcelainStatus: null,
      currentBranch: null,
      fetchOk: false,
      remoteBranchRef: null,
      aheadBehind: null,
    }
  }

  const [gitRoot, shallow, originUrl, upstreamUrl, porcelainStatus, currentBranch] = await Promise.all([
    isGitRepoRoot(input.dir),
    isShallowRepo(input.dir),
    getRemoteUrl(input.dir, 'origin'),
    getRemoteUrl(input.dir, 'upstream'),
    getPorcelainStatus(input.dir),
    getCurrentBranch(input.dir),
  ])

  let fetchOk = false
  let remoteBranchRef: string | null = null
  let aheadBehind: SyncRepositoryProbe['aheadBehind'] = null

  if (gitRoot && originUrl && currentBranch && porcelainStatus?.length === 0 && !shallow) {
    fetchOk = await fetchRemote(input.dir, 'origin')
    if (fetchOk) {
      remoteBranchRef = await getRemoteBranchRef(input.dir, currentBranch)
      if (remoteBranchRef) {
        aheadBehind = await getAheadBehind(input.dir, 'HEAD', `origin/${currentBranch}`)
      }
    }
  }

  return {
    role: input.role,
    label: input.label,
    dir: input.dir,
    exists,
    isGitRoot: gitRoot,
    isShallow: shallow,
    originUrl,
    upstreamUrl,
    expectedUpstreamUrl: input.expectedUpstreamUrl,
    porcelainStatus,
    currentBranch,
    fetchOk,
    remoteBranchRef,
    aheadBehind,
    hasUnpushedLocalCommits: Boolean(aheadBehind && aheadBehind.ahead > 0),
  }
}

export async function buildProjectSyncPlan(
  projectDir: string,
  options: BuildProjectSyncPlanOptions = {},
): Promise<ProjectSyncPlan> {
  const config = readStrictProjectConfig(projectDir)
  const backendDir = join(projectDir, config.backend_name)
  const frontendDir = join(projectDir, config.frontend_name)

  const main = options.mainProbe ?? await inspectMainSyncRepository(projectDir)
  const backend = await inspectSyncRepository({
    role: 'backend',
    label: getRoleLabel('backend'),
    dir: backendDir,
    expectedUpstreamUrl: OFFICIAL_BACKEND_REPO,
  })
  const frontend = await inspectSyncRepository({
    role: 'frontend',
    label: getRoleLabel('frontend'),
    dir: frontendDir,
    expectedUpstreamUrl: OFFICIAL_FRONTEND_REPO,
  })

  const gitmodulesPath = join(projectDir, '.gitmodules')
  const gitmodulesChecks = assessGitmodules({
    content: existsSync(gitmodulesPath) ? readFileSync(gitmodulesPath, 'utf-8') : null,
    backendName: config.backend_name,
    backendOrigin: backend.originUrl,
    frontendName: config.frontend_name,
    frontendOrigin: frontend.originUrl,
  })

  const probes = { main, backend, frontend }
  return {
    config,
    probes,
    precheck: buildSyncPlan(
      probes,
      { gitmodulesErrors: convertGitmodulesChecksToSyncIssues(gitmodulesChecks) },
    ),
  }
}

export async function inspectMainSyncRepository(projectDir: string): Promise<SyncRepositoryProbe> {
  return inspectSyncRepository({
    role: 'main',
    label: getRoleLabel('main'),
    dir: projectDir,
  })
}

export async function inspectUpstreamTarget(probe: SyncRepositoryProbe): Promise<UpstreamRuntimeTarget> {
  if (probe.role === 'main' || !probe.currentBranch || probe.upstreamUrl !== probe.expectedUpstreamUrl) {
    return {
      probe,
      fetchOk: false,
      remoteBranchRef: null,
      upstreamBranch: null,
      aheadBehind: null,
      availableBranches: [],
    }
  }

  const fetchOk = await fetchRemote(probe.dir, 'upstream')
  const availableBranches = fetchOk ? await listRemoteBranches(probe.dir, 'upstream') : []
  const defaultBranch = availableBranches.includes(probe.currentBranch) ? probe.currentBranch : null
  const remoteBranchRef = defaultBranch ? await getRemoteBranchRef(probe.dir, defaultBranch, 'upstream') : null
  const aheadBehind = remoteBranchRef
    ? await getAheadBehind(probe.dir, 'HEAD', `upstream/${defaultBranch}`)
    : null

  return {
    probe,
    fetchOk,
    remoteBranchRef: remoteBranchRef ? `upstream/${defaultBranch}` : null,
    upstreamBranch: defaultBranch,
    aheadBehind,
    availableBranches,
  }
}
