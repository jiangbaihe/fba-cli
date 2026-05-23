import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import {
  getPorcelainStatus,
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
  isShallow: boolean
  originUrl: string | null
  upstreamUrl: string | null
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

async function inspectRepository(dir: string): Promise<RepoRuntimeStatus> {
  const exists = existsSync(dir)
  if (!exists) {
    return {
      exists,
      isGitRepo: false,
      isGitRoot: false,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      porcelainStatus: null,
    }
  }

  const repo = await isGitRepo(dir)
  if (!repo) {
    return {
      exists,
      isGitRepo: false,
      isGitRoot: false,
      isShallow: false,
      originUrl: null,
      upstreamUrl: null,
      porcelainStatus: null,
    }
  }

  const [root, shallow, originUrl, upstreamUrl, porcelainStatus] = await Promise.all([
    isGitRepoRoot(dir),
    isShallowRepo(dir),
    getRemoteUrl(dir, 'origin'),
    getRemoteUrl(dir, 'upstream'),
    getPorcelainStatus(dir),
  ])

  return {
    exists,
    isGitRepo: repo,
    isGitRoot: root,
    isShallow: shallow,
    originUrl,
    upstreamUrl,
    porcelainStatus,
  }
}

export async function buildProjectStatus(projectDir: string): Promise<ProjectStatusInspection> {
  const config = readStrictProjectConfig(projectDir)
  const backendDir = join(projectDir, config.backend_name)
  const frontendDir = join(projectDir, config.frontend_name)

  const [main, backend, frontend] = await Promise.all([
    inspectRepository(projectDir),
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
    content: existsSync(gitmodulesPath) ? readFileSync(gitmodulesPath, 'utf-8') : null,
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
