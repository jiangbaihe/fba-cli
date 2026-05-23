import { rt } from './text.js'
import {
  parseGitHubHttpsUrl,
  type GitHubRepoRef,
} from './github.js'

export interface DefaultRemotePlanInput {
  owner: string
  projectName: string
  backendName: string
  frontendName: string
}

export interface RemotePlan {
  main: string
  backend: string
  frontend: string
}

export function buildDefaultRemotePlan(input: DefaultRemotePlanInput): RemotePlan {
  return {
    main: `https://github.com/${input.owner}/${input.projectName}.git`,
    backend: `https://github.com/${input.owner}/${input.backendName}.git`,
    frontend: `https://github.com/${input.owner}/${input.frontendName}.git`,
  }
}

export interface GitmodulesInput {
  backendName: string
  backendUrl: string
  frontendName: string
  frontendUrl: string
}

export function renderGitmodules(input: GitmodulesInput): string {
  return [
    `[submodule "${input.backendName}"]`,
    `\tpath = ${input.backendName}`,
    `\turl = ${input.backendUrl}`,
    `[submodule "${input.frontendName}"]`,
    `\tpath = ${input.frontendName}`,
    `\turl = ${input.frontendUrl}`,
    '',
  ].join('\n')
}

export function upsertGitmodulesContent(
  currentContent: string,
  input: GitmodulesInput,
): string {
  const targetNames = new Set([input.backendName, input.frontendName])
  const preservedLines: string[] = []
  let skippingTargetSection = false

  for (const line of currentContent.split(/\r?\n/)) {
    const section = line.match(/^\[submodule "(.+)"\]\s*$/)
    if (section) {
      skippingTargetSection = targetNames.has(section[1]!)
    }

    if (!skippingTargetSection) {
      preservedLines.push(line)
    }
  }

  while (preservedLines.length > 0 && preservedLines[preservedLines.length - 1]!.trim() === '') {
    preservedLines.pop()
  }

  const nextSection = renderGitmodules(input).trimEnd().split('\n')
  return [
    ...preservedLines,
    ...(preservedLines.length > 0 ? [''] : []),
    ...nextSection,
    '',
  ].join('\n')
}

export interface NormalizedRemotePlan {
  main: GitHubRepoRef
  backend: GitHubRepoRef
  frontend: GitHubRepoRef
}

export function normalizeRemotePlan(plan: RemotePlan): NormalizedRemotePlan {
  return {
    main: parseRequiredGitHubUrl(plan.main),
    backend: parseRequiredGitHubUrl(plan.backend),
    frontend: parseRequiredGitHubUrl(plan.frontend),
  }
}

export type NormalizeRemotePlanResult =
  | { ok: true; plan: NormalizedRemotePlan }
  | { ok: false; error: string }

export function tryNormalizeRemotePlan(plan: RemotePlan): NormalizeRemotePlanResult {
  try {
    return { ok: true, plan: normalizeRemotePlan(plan) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function isGitHubHttpsUrl(value: string): boolean {
  return Boolean(parseGitHubHttpsUrl(value))
}

export function validateGitHubOwnerName(value: string): string | undefined {
  const owner = value.trim()
  if (!owner) return rt('repoInitOwnerRequired')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    return rt('repoInitOwnerInvalid')
  }
  return undefined
}

export function resolvePromptTextValue(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || defaultValue
}

export function formatGitHubRepoInitError(error: unknown): string {
  const status = getHttpStatus(error)
  if (status === 401) return rt('repoInitGithubAuthFailed')
  if (status === 403) return rt('repoInitGithubPermissionFailed')
  if (status === 422) return rt('repoInitGithubCreateFailed')

  const message = error instanceof Error ? error.message : String(error)
  return `${rt('repoInitGithubRequestFailed')}: ${message}`
}

function parseRequiredGitHubUrl(url: string): GitHubRepoRef {
  const ref = parseGitHubHttpsUrl(url)
  if (!ref) throw new Error(`${rt('repoInitOnlyGithubHttps')}: ${url}`)
  return ref
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const maybeError = error as { status?: unknown; response?: { status?: unknown } }
  const status = maybeError.status ?? maybeError.response?.status
  return typeof status === 'number' ? status : null
}
