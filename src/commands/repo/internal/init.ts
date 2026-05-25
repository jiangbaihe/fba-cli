import { rt } from './text.js'
import {
  OFFICIAL_BACKEND_REPO,
  OFFICIAL_FRONTEND_REPO,
} from './constants.js'
import {
  parseGitHubHttpsUrl,
  type GitHubRepoRef,
} from './github.js'
import { formatErrorMessage, redactUrlCredentials } from './display.js'

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

export interface ExistingRemotePlanInput {
  generated: RemotePlan
  mainOrigin?: string | null
  backendOrigin?: string | null
  frontendOrigin?: string | null
  gitmodulesBackendUrl?: string | null
  gitmodulesFrontendUrl?: string | null
}

export function preferExistingRemotePlan(input: ExistingRemotePlanInput): RemotePlan {
  return {
    main: preferGitHubUrl(input.mainOrigin, input.generated.main),
    backend: preferGitHubUrl(
      preferNonOfficialChildUrl(input.backendOrigin)
        ?? preferNonOfficialChildUrl(input.gitmodulesBackendUrl),
      input.generated.backend,
    ),
    frontend: preferGitHubUrl(
      preferNonOfficialChildUrl(input.frontendOrigin)
        ?? preferNonOfficialChildUrl(input.gitmodulesFrontendUrl),
      input.generated.frontend,
    ),
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
  const targetPaths = targetNames
  const preservedLines: string[] = []
  const sections = splitGitmodulesSections(currentContent)

  for (const section of sections) {
    if (shouldReplaceGitmoduleSection(section, targetNames, targetPaths)) continue
    preservedLines.push(...section.lines)
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

interface GitmodulesSection {
  name: string | null
  lines: string[]
}

function splitGitmodulesSections(content: string): GitmodulesSection[] {
  const sections: GitmodulesSection[] = []
  let current: GitmodulesSection = { name: null, lines: [] }

  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\[submodule "(.+)"\]\s*$/)
    if (section) {
      if (current.lines.length > 0) sections.push(current)
      current = { name: section[1]!, lines: [line] }
      continue
    }

    current.lines.push(line)
  }

  if (current.lines.length > 0) sections.push(current)
  return sections
}

function shouldReplaceGitmoduleSection(
  section: GitmodulesSection,
  targetNames: Set<string>,
  targetPaths: Set<string>,
): boolean {
  if (section.name && targetNames.has(section.name)) return true

  const path = findGitmodulePathInSection(section)
  return path !== null && targetPaths.has(path)
}

function findGitmodulePathInSection(section: GitmodulesSection): string | null {
  for (const line of section.lines) {
    const match = line.trim().match(/^path\s*=\s*(.+)$/)
    if (match) return match[1]!.trim()
  }

  return null
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

export function validateDistinctRemotePlan(plan: NormalizedRemotePlan): string | undefined {
  const seen = new Map<string, keyof NormalizedRemotePlan>()
  for (const role of ['main', 'backend', 'frontend'] as const) {
    const ref = plan[role]
    const key = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
    const previous = seen.get(key)
    if (previous) {
      return `${previous} and ${role} GitHub repositories must be different`
    }
    seen.set(key, role)
  }
  return undefined
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
      error: formatErrorMessage(error),
    }
  }
}

export function isGitHubHttpsUrl(value: string): boolean {
  return Boolean(parseGitHubHttpsUrl(value))
}

function preferGitHubUrl(candidate: string | null | undefined, fallback: string): string {
  return candidate && isGitHubHttpsUrl(candidate) ? candidate : fallback
}

function preferNonOfficialChildUrl(candidate: string | null | undefined): string | null {
  if (!candidate || !isGitHubHttpsUrl(candidate)) return null
  return isOfficialTemplateUrl(candidate) ? null : candidate
}

function isOfficialTemplateUrl(url: string): boolean {
  const normalized = parseGitHubHttpsUrl(url)?.normalizedUrl
  return normalized === OFFICIAL_BACKEND_REPO || normalized === OFFICIAL_FRONTEND_REPO
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

  return `${rt('repoInitGithubRequestFailed')}: ${formatErrorMessage(error)}`
}

function parseRequiredGitHubUrl(url: string): GitHubRepoRef {
  const ref = parseGitHubHttpsUrl(url)
  if (!ref) throw new Error(`${rt('repoInitOnlyGithubHttps')}: ${redactUrlCredentials(url) ?? url}`)
  return ref
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const maybeError = error as { status?: unknown; response?: { status?: unknown } }
  const status = maybeError.status ?? maybeError.response?.status
  return typeof status === 'number' ? status : null
}
