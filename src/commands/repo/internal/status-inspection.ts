import { existsSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import { isDirectoryEmpty, readOptionalTextFile } from './files.js'
import {
  getPorcelainStatus,
  getCurrentBranch,
  getRemoteUrl,
  isGitRepo,
  isGitRepoRoot,
  isShallowRepo,
} from './git.js'
import { readStrictProjectConfig } from './project.js'
import {
  assessGitmodules,
  assessRepository,
  getOverallStatus,
  getRecommendedStatusActions,
  type RecommendedStatusAction,
  type StatusCheck,
  type StatusLevel,
} from './status.js'

interface RepoRuntimeStatus {
  exists: boolean
  isGitRepo: boolean
  isGitRoot: boolean
  isEmptyDirectory?: boolean
  isShallow: boolean
  originUrl: string | null
  upstreamUrl: string | null
  currentBranch: string | null
  porcelainStatus: string[] | null
}

export interface ProjectStatusInspection {
  config: ReturnType<typeof readStrictProjectConfig>
  mainChecks: StatusCheck[]
  backendChecks: StatusCheck[]
  frontendChecks: StatusCheck[]
  gitmodulesChecks: StatusCheck[]
  allChecks: StatusCheck[]
  overall: StatusLevel
  recommendedActions: RecommendedStatusAction[]
}

async function inspectRepository(
  dir: string,
  options: { allowInheritedGitRepo?: boolean } = {},
): Promise<RepoRuntimeStatus> {
  const exists = existsSync(dir)
  if (!exists) {
    return {
      exists,
      isGitRepo: false,
      isGitRoot: false,
      isEmptyDirectory: undefined,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      currentBranch: null,
      porcelainStatus: null,
    }
  }

  const root = await isGitRepoRoot(dir)
  if (!root) {
    const repo = options.allowInheritedGitRepo ? await isGitRepo(dir) : false
    return {
      exists,
      isGitRepo: repo,
      isGitRoot: false,
      isEmptyDirectory: isDirectoryEmpty(dir),
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      currentBranch: null,
      porcelainStatus: null,
    }
  }

  const [shallow, originUrl, upstreamUrl, currentBranch, porcelainStatus] = await Promise.all([
    isShallowRepo(dir),
    getRemoteUrl(dir, 'origin'),
    getRemoteUrl(dir, 'upstream'),
    getCurrentBranch(dir),
    getPorcelainStatus(dir),
  ])

  return {
    exists,
    isGitRepo: true,
    isGitRoot: root,
    isEmptyDirectory: false,
    isShallow: shallow,
    originUrl,
    upstreamUrl,
    currentBranch,
    porcelainStatus,
  }
}

export async function buildProjectStatus(projectDir: string): Promise<ProjectStatusInspection> {
  const config = readStrictProjectConfig(projectDir)
  const backendDir = join(projectDir, config.backend_name)
  const frontendDir = join(projectDir, config.frontend_name)

  const [main, backend, frontend] = await Promise.all([
    inspectRepository(projectDir, { allowInheritedGitRepo: true }),
    inspectRepository(backendDir),
    inspectRepository(frontendDir),
  ])

  const mainChecks = assessRepository({
    role: 'main',
    label: rt('repoInitRoleMain'),
    ...main,
    expectedUpstreamUrl: undefined,
  })
  const backendChecks = assessRepository({
    role: 'backend',
    label: rt('repoInitRoleBackend'),
    ...backend,
    expectedUpstreamUrl: OFFICIAL_BACKEND_REPO,
  })
  const frontendChecks = assessRepository({
    role: 'frontend',
    label: rt('repoInitRoleFrontend'),
    ...frontend,
    expectedUpstreamUrl: OFFICIAL_FRONTEND_REPO,
  })

  const gitmodulesPath = join(projectDir, '.gitmodules')
  const gitmodulesChecks = assessGitmodules({
    content: readOptionalTextFile(gitmodulesPath),
    backendName: config.backend_name,
    backendOrigin: backend.originUrl,
    frontendName: config.frontend_name,
    frontendOrigin: frontend.originUrl,
  })

  const allChecks = [
    ...mainChecks,
    ...backendChecks,
    ...frontendChecks,
    ...gitmodulesChecks,
  ]
  const overall = getOverallStatus(allChecks)

  return {
    config,
    mainChecks,
    backendChecks,
    frontendChecks,
    gitmodulesChecks,
    allChecks,
    overall,
    recommendedActions: getRecommendedStatusActions(allChecks),
  }
}
