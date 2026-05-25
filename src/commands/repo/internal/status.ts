import { rt } from './text.js'
import { redactUrlCredentials } from './display.js'

export type StatusLevel = 'ok' | 'warn' | 'error'

export interface StatusCheck {
  code: string
  level: StatusLevel
  message: string
  detail?: string
}

export type RecommendedStatusAction = 'init' | 'sync' | 'push'

export type RepositoryRole = 'main' | 'backend' | 'frontend'

export interface RepositoryAssessmentInput {
  role: RepositoryRole
  label: string
  exists: boolean
  isGitRepo: boolean
  isGitRoot: boolean
  isEmptyDirectory?: boolean
  isShallow: boolean
  originUrl: string | null
  upstreamUrl: string | null
  currentBranch: string | null
  expectedUpstreamUrl?: string
  porcelainStatus: string[] | null
}

export interface GitmoduleEntry {
  path?: string
  url?: string
}

export type GitmodulesMap = Record<string, GitmoduleEntry>

export function getOverallStatus(checks: StatusCheck[]): StatusLevel {
  if (checks.some((check) => check.level === 'error')) return 'error'
  if (checks.some((check) => check.level === 'warn')) return 'warn'
  return 'ok'
}

export function getRecommendedStatusActions(checks: StatusCheck[]): RecommendedStatusAction[] {
  const repairableMissingChildren = getInitRepairableMissingChildren(checks)
  const repairableMissingGitmodules = isMissingGitmodulesFileRepairable(checks)
  const hasBlockingError = checks.some((check) => (
    check.level === 'error' && !isRepoInitRepairableIssue(
      check,
      repairableMissingChildren,
      repairableMissingGitmodules,
    )
  ))
  if (hasBlockingError) return []

  const hasSetupIssue = checks.some((check) => (
    isRepoInitRepairableIssue(check, repairableMissingChildren, repairableMissingGitmodules)
  ))
  if (hasSetupIssue) return ['init']

  if (getOverallStatus(checks) === 'ok') return ['sync', 'push']

  return []
}

function getInitRepairableMissingChildren(checks: StatusCheck[]): Set<'backend' | 'frontend'> {
  const result = new Set<'backend' | 'frontend'>()
  const mainReadyForSubmodules = !checks.some((check) => (
    check.level !== 'ok' && (check.code === 'main.git' || check.code === 'main.root')
  ))

  for (const role of ['backend', 'frontend'] as const) {
    const missingDir = checks.some((check) => (
      check.code === `${role}.dir` && check.level !== 'ok'
    ))
    if (!missingDir) {
      result.add(role)
      continue
    }

    if (!mainReadyForSubmodules) continue

    const hasBlockingGitmodulesIssue = checks.some((check) => (
      check.level !== 'ok' && (
        check.code === 'gitmodules.file' ||
        check.code === `gitmodules.${role}.entry` ||
        check.code === `gitmodules.${role}.path`
      )
    ))
    if (!hasBlockingGitmodulesIssue) result.add(role)
  }

  return result
}

function isMissingGitmodulesFileRepairable(checks: StatusCheck[]): boolean {
  const missingGitmodules = checks.some((check) => (
    check.code === 'gitmodules.file' && check.level !== 'ok'
  ))
  if (!missingGitmodules) return false

  return [
    'main.git',
    'main.root',
    'backend.git',
    'backend.root',
    'frontend.git',
    'frontend.root',
  ].every((code) => checks.some((check) => check.code === code && check.level === 'ok'))
}

function isRepoInitRepairableIssue(
  check: StatusCheck,
  repairableMissingChildren: Set<'backend' | 'frontend'>,
  repairableMissingGitmodules: boolean,
): boolean {
  if (check.level === 'ok') return false
  if (check.code === 'gitmodules.file') return repairableMissingGitmodules
  if (check.code === 'main.upstream') return false
  if (check.code === 'backend.dir') return repairableMissingChildren.has('backend')
  if (check.code === 'frontend.dir') return repairableMissingChildren.has('frontend')

  return (
    check.code.endsWith('.origin') ||
    check.code.endsWith('.upstream') ||
    check.code === 'main.git' ||
    check.code === 'main.root' ||
    check.code === 'backend.git' ||
    check.code === 'backend.root' ||
    check.code === 'backend.branch' ||
    check.code === 'backend.shallow' ||
    check.code === 'frontend.git' ||
    check.code === 'frontend.root' ||
    check.code === 'frontend.branch' ||
    check.code === 'frontend.shallow' ||
    (check.code.startsWith('gitmodules.') && check.code !== 'gitmodules.file')
  )
}

export function parseGitmodules(content: string): GitmodulesMap {
  const entries: GitmodulesMap = {}
  let currentName: string | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const section = line.match(/^\[submodule "(.+)"\]$/)
    if (section) {
      currentName = section[1]!
      entries[currentName] = {}
      continue
    }

    if (!currentName) continue
    const keyValue = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!keyValue) continue

    const key = keyValue[1]!
    const value = keyValue[2]!.trim()
    if (key === 'path' || key === 'url') {
      entries[currentName]![key] = value
    }
  }

  return entries
}

export function assessRepository(input: RepositoryAssessmentInput): StatusCheck[] {
  const checks: StatusCheck[] = []
  const prefix = input.role

  if (!input.exists) {
    return [{
      code: `${prefix}.dir`,
      level: 'error',
      message: rt('repoStatusDirMissing', { label: input.label }),
    }]
  }

  checks.push({
    code: `${prefix}.git`,
    level: input.isGitRepo ? 'ok' : 'error',
    message: input.isGitRepo
      ? rt('repoStatusGitOk', { label: input.label })
      : rt('repoStatusGitError', { label: input.label }),
  })

  if (
    input.role !== 'main' &&
    !input.isGitRoot &&
    input.isEmptyDirectory === false
  ) {
    checks.push({
      code: `${prefix}.dirContent`,
      level: 'error',
      message: rt('repoStatusChildDirContentError', { label: input.label }),
    })
  }

  if (!input.isGitRepo) return checks

  checks.push({
    code: `${prefix}.root`,
    level: input.isGitRoot ? 'ok' : 'warn',
    message: input.isGitRoot
      ? rt('repoStatusRootOk', { label: input.label })
      : rt('repoStatusRootWarn', { label: input.label }),
  })

  checks.push({
    code: `${prefix}.shallow`,
    level: input.isShallow ? 'warn' : 'ok',
    message: input.isShallow
      ? rt('repoStatusShallowWarn', { label: input.label })
      : rt('repoStatusShallowOk', { label: input.label }),
  })

  checks.push({
    code: `${prefix}.origin`,
    level: input.originUrl ? 'ok' : 'warn',
    message: input.originUrl
      ? rt('repoStatusOriginOk', { label: input.label })
      : rt('repoStatusOriginWarn', { label: input.label }),
    detail: redactUrlCredentials(input.originUrl),
  })

  checks.push({
    code: `${prefix}.branch`,
    level: input.currentBranch ? 'ok' : 'warn',
    message: input.currentBranch
      ? rt('repoStatusBranchOk', { label: input.label, branch: input.currentBranch })
      : rt('repoStatusBranchWarn', { label: input.label }),
  })

  if (input.expectedUpstreamUrl !== undefined) {
    const upstreamMatches = input.upstreamUrl === input.expectedUpstreamUrl
    checks.push({
      code: `${prefix}.upstream`,
      level: upstreamMatches ? 'ok' : 'warn',
      message: upstreamMatches
        ? rt('repoStatusUpstreamOk', { label: input.label })
        : rt('repoStatusUpstreamWarn', { label: input.label }),
      detail: formatExpectedActual(input.expectedUpstreamUrl, input.upstreamUrl),
    })
  } else if (input.upstreamUrl) {
    checks.push({
      code: `${prefix}.upstream`,
      level: input.role === 'main' ? 'warn' : 'ok',
      message: rt('repoStatusUpstreamExists', { label: input.label }),
      detail: redactUrlCredentials(input.upstreamUrl),
    })
  }

  if (input.porcelainStatus === null) {
    checks.push({
      code: `${prefix}.workingTree`,
      level: 'warn',
      message: rt('repoStatusWorkingTreeUnreadable', { label: input.label }),
    })
  } else {
    checks.push({
      code: `${prefix}.workingTree`,
      level: input.porcelainStatus.length === 0 ? 'ok' : 'warn',
      message: input.porcelainStatus.length === 0
        ? rt('repoStatusWorkingTreeOk', { label: input.label })
        : rt('repoStatusWorkingTreeWarn', { label: input.label }),
      detail: input.porcelainStatus.length > 0
        ? rt('repoStatusChangedItems', { count: String(input.porcelainStatus.length) })
        : undefined,
    })
  }

  return checks
}

export interface AssessGitmodulesInput {
  content: string | null
  backendName: string
  backendOrigin: string | null
  frontendName: string
  frontendOrigin: string | null
}

export function assessGitmodules(input: AssessGitmodulesInput): StatusCheck[] {
  if (input.content === null) {
    return [{
      code: 'gitmodules.file',
      level: 'warn',
      message: rt('repoStatusGitmodulesMissing'),
    }]
  }

  const entries = parseGitmodules(input.content)
  return [
    ...assessGitmoduleEntry(
      'backend',
      findGitmoduleEntry(entries, input.backendName),
      input.backendName,
      input.backendOrigin,
    ),
    ...assessGitmoduleEntry(
      'frontend',
      findGitmoduleEntry(entries, input.frontendName),
      input.frontendName,
      input.frontendOrigin,
    ),
  ]
}

function findGitmoduleEntry(entries: GitmodulesMap, expectedPath: string): GitmoduleEntry | undefined {
  return entries[expectedPath] ?? Object.values(entries).find((entry) => entry.path === expectedPath)
}

function assessGitmoduleEntry(
  role: 'backend' | 'frontend',
  entry: GitmoduleEntry | undefined,
  expectedPath: string,
  expectedUrl: string | null,
): StatusCheck[] {
  if (!entry) {
    return [{
      code: `gitmodules.${role}.entry`,
      level: 'warn',
      message: rt('repoStatusGitmodulesEntryMissing', {
        role: getGitmoduleRoleLabel(role),
      }),
    }]
  }

  const checks: StatusCheck[] = []
  checks.push({
    code: `gitmodules.${role}.path`,
    level: entry.path === expectedPath ? 'ok' : 'warn',
    message: entry.path === expectedPath
      ? rt('repoStatusGitmodulesPathOk', { role: getGitmoduleRoleLabel(role) })
      : rt('repoStatusGitmodulesPathWarn', { role: getGitmoduleRoleLabel(role) }),
    detail: formatExpectedActual(expectedPath, entry.path),
  })

  checks.push({
    code: `gitmodules.${role}.url`,
    level: expectedUrl && entry.url === expectedUrl ? 'ok' : 'warn',
    message: expectedUrl && entry.url === expectedUrl
      ? rt('repoStatusGitmodulesUrlOk', { role: getGitmoduleRoleLabel(role) })
      : rt('repoStatusGitmodulesUrlWarn', { role: getGitmoduleRoleLabel(role) }),
    detail: formatExpectedActual(expectedUrl ?? rt('repoStatusOriginMissing'), entry.url),
  })

  return checks
}

function getGitmoduleRoleLabel(role: 'backend' | 'frontend'): string {
  return role === 'backend' ? rt('repoInitRoleBackend') : rt('repoInitRoleFrontend')
}

function formatExpectedActual(expected: string, actual: string | undefined | null): string {
  return rt('repoStatusExpectedActual', {
    expected: redactUrlCredentials(expected) ?? expected,
    actual: redactUrlCredentials(actual) ?? rt('repoStatusMissing'),
  })
}
