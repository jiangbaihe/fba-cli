import { existsSync } from 'fs'
import { join } from 'path'
import { rt } from './text.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import { readOptionalTextFile } from './files.js'
import {
  getCurrentBranch,
  getPorcelainStatus,
  getRemoteUrl,
  isGitRepoRoot,
  isShallowRepo,
} from './git.js'
import { readStrictProjectConfig } from './project.js'
import {
  buildPushPlan,
  convertGitmodulesChecksToPushIssues,
  getSelectablePushItemsFromProbes,
  type BuildPushPlanOptions,
  type PushRepoRole,
  type PushRepositoryProbe,
} from './push.js'
import { assessGitmodules } from './status.js'

export interface ProjectPushPlan {
  config: ReturnType<typeof readStrictProjectConfig>
  probes: Record<PushRepoRole, PushRepositoryProbe>
  options: BuildPushPlanOptions
  selectableItems: ReturnType<typeof getSelectablePushItemsFromProbes>
  result: ReturnType<typeof buildPushPlan>
}

function getRoleLabel(role: PushRepoRole): string {
  if (role === 'main') return rt('repoInitRoleMain')
  if (role === 'backend') return rt('repoInitRoleBackend')
  return rt('repoInitRoleFrontend')
}

async function inspectPushRepository(input: {
  role: PushRepoRole
  label: string
  dir: string
  expectedUpstreamUrl?: string
}): Promise<PushRepositoryProbe> {
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
    }
  }

  const gitRoot = await isGitRepoRoot(input.dir)
  if (!gitRoot) {
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
    }
  }

  const [shallow, originUrl, upstreamUrl, porcelainStatus, currentBranch] = await Promise.all([
    isShallowRepo(input.dir),
    getRemoteUrl(input.dir, 'origin'),
    getRemoteUrl(input.dir, 'upstream'),
    getPorcelainStatus(input.dir),
    getCurrentBranch(input.dir),
  ])

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
  }
}

export async function buildProjectPushPlan(projectDir: string): Promise<ProjectPushPlan> {
  const config = readStrictProjectConfig(projectDir)
  const backendDir = join(projectDir, config.backend_name)
  const frontendDir = join(projectDir, config.frontend_name)

  const [main, backend, frontend] = await Promise.all([
    inspectPushRepository({
      role: 'main',
      label: getRoleLabel('main'),
      dir: projectDir,
    }),
    inspectPushRepository({
      role: 'backend',
      label: getRoleLabel('backend'),
      dir: backendDir,
      expectedUpstreamUrl: OFFICIAL_BACKEND_REPO,
    }),
    inspectPushRepository({
      role: 'frontend',
      label: getRoleLabel('frontend'),
      dir: frontendDir,
      expectedUpstreamUrl: OFFICIAL_FRONTEND_REPO,
    }),
  ])
  const gitmodulesPath = join(projectDir, '.gitmodules')
  const gitmodulesChecks = assessGitmodules({
    content: readOptionalTextFile(gitmodulesPath),
    backendName: config.backend_name,
    backendOrigin: backend.originUrl,
    frontendName: config.frontend_name,
    frontendOrigin: frontend.originUrl,
  })

  const probes = { main, backend, frontend }
  const options = {
    gitmodulesErrors: convertGitmodulesChecksToPushIssues(gitmodulesChecks),
    mainAllowedDirtyPaths: [config.backend_name, config.frontend_name],
  }

  return {
    config,
    probes,
    options,
    selectableItems: getSelectablePushItemsFromProbes(probes),
    result: buildPushPlan(probes, options),
  }
}
