import type { StatusCheck } from './status.js'

export type SyncRepoRole = 'main' | 'backend' | 'frontend'

export interface AheadBehind {
  ahead: number
  behind: number
}

export type SyncRepositoryState =
  | 'up-to-date'
  | 'fast-forward'
  | 'ahead'
  | 'diverged'
  | 'missing-remote-branch'
  | 'unknown'

export interface SyncRepositoryProbe {
  role: SyncRepoRole
  label: string
  dir: string
  exists: boolean
  isGitRoot: boolean
  isShallow: boolean
  originUrl: string | null
  upstreamUrl: string | null
  expectedUpstreamUrl?: string
  porcelainStatus: string[] | null
  currentBranch: string | null
  fetchOk: boolean
  remoteBranchRef: string | null
  aheadBehind: AheadBehind | null
  pushedLocalCommits?: boolean
  hasUnpushedLocalCommits?: boolean
}

export interface SyncPlanItem {
  role: SyncRepoRole
  label: string
  dir: string
  branch: string
  originUrl: string
  state: SyncRepositoryState
  shouldUpdate: boolean
}

export interface SyncPlanIssue {
  role: SyncRepoRole
  label: string
  code: string
  message: string
}

export type SyncPlanResult =
  | { ok: true; items: SyncPlanItem[]; warnings: SyncPlanIssue[] }
  | { ok: false; errors: SyncPlanIssue[]; warnings: SyncPlanIssue[] }

export interface BuildSyncPlanOptions {
  gitmodulesErrors?: SyncPlanIssue[]
}

export type SyncExecutionState = 'updated' | 'skipped' | 'failed' | 'pending'

export type OriginSyncAction =
  | 'skip'
  | 'fast-forward-origin'
  | 'rebase-origin'
  | 'merge-origin'
  | 'push-or-skip'
  | 'cancel'

export type UpstreamSyncAction =
  | 'skip'
  | 'fast-forward-upstream'
  | 'rebase-upstream'
  | 'merge-upstream'
  | 'choose-upstream-branch'
  | 'cancel'

export type SyncActionWarning = 'already-pushed-local-commits'

export interface OriginSyncTarget {
  probe: SyncRepositoryProbe
  remoteBranchRef: string | null
  aheadBehind: AheadBehind | null
}

export interface OriginSyncPlanItem {
  role: SyncRepoRole
  label: string
  dir: string
  branch: string
  targetRef: string | null
  state: SyncRepositoryState
  recommendedAction: OriginSyncAction
  actions: OriginSyncAction[]
  warnings: SyncActionWarning[]
}

export interface UpstreamSyncTarget {
  probe: SyncRepositoryProbe
  remoteBranchRef: string | null
  upstreamBranch: string | null
  aheadBehind: AheadBehind | null
  availableBranches: string[]
}

export interface UpstreamSyncPlanItem {
  role: Exclude<SyncRepoRole, 'main'>
  label: string
  dir: string
  branch: string
  upstreamBranch: string | null
  targetRef: string | null
  state: SyncRepositoryState
  recommendedAction: UpstreamSyncAction
  actions: UpstreamSyncAction[]
  warnings: SyncActionWarning[]
  availableBranches: string[]
}

export type SyncWizardAction = OriginSyncAction | UpstreamSyncAction

export interface SyncExecutionResult {
  item: SyncPlanItem
  state: SyncExecutionState
}

export interface SyncExecutionSummary {
  ok: boolean
  updated: string[]
  skipped: string[]
  failed: string[]
  pending: string[]
}

export interface MainRepositoryChangePlan {
  committablePaths: string[]
  unrelatedLines: string[]
}

export function getSyncOrder(): SyncRepoRole[] {
  return ['main', 'backend', 'frontend']
}

export function getOriginSyncOrder(): SyncRepoRole[] {
  return ['main', 'backend', 'frontend']
}

export function getUpstreamSyncOrder(): Array<Exclude<SyncRepoRole, 'main'>> {
  return ['backend', 'frontend']
}

export function classifySyncState(probe: SyncRepositoryProbe): SyncRepositoryState {
  if (!probe.remoteBranchRef) return 'missing-remote-branch'
  if (!probe.aheadBehind) return 'unknown'

  const { ahead, behind } = probe.aheadBehind
  if (ahead === 0 && behind === 0) return 'up-to-date'
  if (ahead === 0 && behind > 0) return 'fast-forward'
  if (ahead > 0 && behind === 0) return 'ahead'
  return 'diverged'
}

export function buildOriginSyncPlan(targets: OriginSyncTarget[]): OriginSyncPlanItem[] {
  const targetByRole = new Map(targets.map((target) => [target.probe.role, target]))

  return getOriginSyncOrder()
    .map((role) => targetByRole.get(role))
    .filter((target): target is OriginSyncTarget => Boolean(target))
    .map((target) => {
      const state = classifyTargetSyncState(target.remoteBranchRef, target.aheadBehind)
      const warnings = getRebaseWarnings(target.probe)
      const recommendedAction = getRecommendedOriginAction(state, warnings)
      return {
        role: target.probe.role,
        label: target.probe.label,
        dir: target.probe.dir,
        branch: target.probe.currentBranch ?? '',
        targetRef: target.remoteBranchRef,
        state,
        recommendedAction,
        actions: getOriginActions(state, recommendedAction),
        warnings,
      }
    })
}

export function buildUpstreamSyncPlan(targets: UpstreamSyncTarget[]): UpstreamSyncPlanItem[] {
  const targetByRole = new Map(targets.map((target) => [target.probe.role, target]))

  return getUpstreamSyncOrder()
    .map((role) => targetByRole.get(role))
    .filter((target): target is UpstreamSyncTarget => Boolean(target))
    .map((target) => {
      const state = classifyTargetSyncState(target.remoteBranchRef, target.aheadBehind)
      const warnings = getUpstreamRebaseWarnings(target)
      const recommendedAction = getRecommendedUpstreamAction(state, warnings)
      return {
        role: target.probe.role as Exclude<SyncRepoRole, 'main'>,
        label: target.probe.label,
        dir: target.probe.dir,
        branch: target.probe.currentBranch ?? '',
        upstreamBranch: target.upstreamBranch,
        targetRef: target.remoteBranchRef,
        state,
        recommendedAction,
        actions: getUpstreamActions(state, recommendedAction),
        warnings,
        availableBranches: target.availableBranches,
      }
    })
}

export function formatSyncActionSummary(
  label: string,
  action: SyncWizardAction,
  targetRef: string | null,
): string {
  const target = targetRef ? ` ${targetRef}` : ''
  return `${label}: ${action}${target}`
}

export function buildSyncPlan(
  input: Record<SyncRepoRole, SyncRepositoryProbe>,
  options: BuildSyncPlanOptions = {},
): SyncPlanResult {
  const errors: SyncPlanIssue[] = [...(options.gitmodulesErrors ?? [])]
  const warnings: SyncPlanIssue[] = []

  for (const role of getSyncOrder()) {
    assessProbe(input[role], errors, warnings)
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }

  return {
    ok: true,
    warnings,
    items: getSyncOrder().map((role) => {
      const probe = input[role]
      const state = classifySyncState(probe)
      return {
        role: probe.role,
        label: probe.label,
        dir: probe.dir,
        branch: probe.currentBranch!,
        originUrl: probe.originUrl!,
        state,
        shouldUpdate: state === 'fast-forward',
      }
    }),
  }
}

export function convertGitmodulesChecksToSyncIssues(checks: StatusCheck[]): SyncPlanIssue[] {
  return checks
    .filter((check) => check.level !== 'ok')
    .map((check) => ({
      role: 'main',
      label: '.gitmodules',
      code: check.code,
      message: check.message,
    }))
}

export function getBlockingSyncPrecheckIssues(issues: SyncPlanIssue[]): SyncPlanIssue[] {
  return issues.filter((issue) => ![
    'main.remoteBranch',
    'backend.remoteBranch',
    'frontend.remoteBranch',
    'main.ahead',
    'backend.ahead',
    'frontend.ahead',
    'main.diverged',
    'backend.diverged',
    'frontend.diverged',
  ].includes(issue.code))
}

export function getMainRepositoryChangePlan(
  porcelainStatus: readonly string[],
  allowedPaths: readonly string[],
): MainRepositoryChangePlan {
  const allowed = new Set(allowedPaths)
  const committablePaths: string[] = []
  const unrelatedLines: string[] = []

  for (const line of porcelainStatus) {
    const path = getPorcelainPath(line)
    if (path && allowed.has(path)) {
      if (!committablePaths.includes(path)) committablePaths.push(path)
      continue
    }
    unrelatedLines.push(line)
  }

  return { committablePaths, unrelatedLines }
}

export function markSyncResult(item: SyncPlanItem, ok: boolean | null): SyncExecutionResult {
  if (!item.shouldUpdate) {
    return { item, state: 'skipped' }
  }

  return {
    item,
    state: ok === null ? 'pending' : ok ? 'updated' : 'failed',
  }
}

export function summarizeSyncResults(results: SyncExecutionResult[]): SyncExecutionSummary {
  const updated = results
    .filter((result) => result.state === 'updated')
    .map((result) => result.item.label)
  const skipped = results
    .filter((result) => result.state === 'skipped')
    .map((result) => result.item.label)
  const failed = results
    .filter((result) => result.state === 'failed')
    .map((result) => result.item.label)
  const pending = results
    .filter((result) => result.state === 'pending')
    .map((result) => result.item.label)

  return {
    ok: failed.length === 0 && pending.length === 0,
    updated,
    skipped,
    failed,
    pending,
  }
}

export async function runSyncSequence(
  items: readonly SyncPlanItem[],
  fastForward: (item: SyncPlanItem) => Promise<boolean>,
): Promise<SyncExecutionResult[]> {
  const results: SyncExecutionResult[] = []
  let failed = false

  for (const item of items) {
    if (!item.shouldUpdate) {
      results.push(markSyncResult(item, null))
      continue
    }

    if (failed) {
      results.push(markSyncResult(item, null))
      continue
    }

    const ok = await fastForward(item)
    results.push(markSyncResult(item, ok))
    if (!ok) failed = true
  }

  return results
}

function assessProbe(
  probe: SyncRepositoryProbe,
  errors: SyncPlanIssue[],
  warnings: SyncPlanIssue[],
): void {
  const errorCountBeforeLocalChecks = errors.length

  if (!probe.exists) {
    errors.push(issue(probe, `${probe.role}.dir`, `${probe.label} directory is missing`))
    return
  }

  if (!probe.isGitRoot) {
    errors.push(issue(probe, `${probe.role}.gitRoot`, `${probe.label} is not a Git root`))
  }

  if (probe.isShallow) {
    errors.push(issue(probe, `${probe.role}.shallow`, `${probe.label} is a shallow clone`))
  }

  if (!probe.originUrl) {
    errors.push(issue(probe, `${probe.role}.origin`, `${probe.label} has no origin remote`))
  }

  if (!probe.currentBranch) {
    errors.push(issue(probe, `${probe.role}.branch`, `${probe.label} is detached or has no current branch`))
  }

  if (probe.porcelainStatus === null) {
    errors.push(issue(probe, `${probe.role}.workingTree`, `${probe.label} working tree status could not be read`))
  } else if (probe.porcelainStatus.length > 0) {
    errors.push(issue(probe, `${probe.role}.workingTree`, `${probe.label} working tree is not clean`))
  }

  if (errors.length > errorCountBeforeLocalChecks) {
    return
  }

  if (!probe.fetchOk) {
    errors.push(issue(probe, `${probe.role}.fetch`, `${probe.label} origin fetch failed`))
    return
  }

  if (probe.originUrl && probe.currentBranch) {
    const state = classifySyncState(probe)
    if (state === 'missing-remote-branch') {
      errors.push(issue(probe, `${probe.role}.remoteBranch`, `${probe.label} origin/${probe.currentBranch} is missing`))
    } else if (state === 'unknown') {
      errors.push(issue(probe, `${probe.role}.compare`, `${probe.label} could not compare local branch with origin/${probe.currentBranch}`))
    } else if (state === 'ahead') {
      errors.push(issue(probe, `${probe.role}.ahead`, `${probe.label} has local commits not on origin/${probe.currentBranch}`))
    } else if (state === 'diverged') {
      errors.push(issue(probe, `${probe.role}.diverged`, `${probe.label} has diverged from origin/${probe.currentBranch}`))
    }
  }

  if (
    probe.role !== 'main' &&
    probe.expectedUpstreamUrl !== undefined &&
    probe.upstreamUrl !== probe.expectedUpstreamUrl
  ) {
    warnings.push(issue(probe, `${probe.role}.upstream`, `${probe.label} upstream does not match official repository`))
  }
}

function issue(probe: SyncRepositoryProbe, code: string, message: string): SyncPlanIssue {
  return {
    role: probe.role,
    label: probe.label,
    code,
    message,
  }
}

function getPorcelainPath(line: string): string | null {
  const renameMarker = ' -> '
  const rawPath = line.slice(3).trim()
  if (!rawPath) return null

  return rawPath.includes(renameMarker)
    ? rawPath.slice(rawPath.lastIndexOf(renameMarker) + renameMarker.length).trim()
    : rawPath
}

function classifyTargetSyncState(
  remoteBranchRef: string | null,
  aheadBehind: AheadBehind | null,
): SyncRepositoryState {
  return classifySyncState({
    role: 'backend',
    label: '',
    dir: '',
    exists: true,
    isGitRoot: true,
    isShallow: false,
    originUrl: '',
    upstreamUrl: null,
    porcelainStatus: [],
    currentBranch: 'main',
    fetchOk: true,
    remoteBranchRef,
    aheadBehind,
  })
}

function getRebaseWarnings(probe: SyncRepositoryProbe): SyncActionWarning[] {
  return probe.pushedLocalCommits ? ['already-pushed-local-commits'] : []
}

function getUpstreamRebaseWarnings(target: UpstreamSyncTarget): SyncActionWarning[] {
  if (!target.aheadBehind || target.aheadBehind.ahead === 0) return []
  if (target.aheadBehind.behind === 0) return []
  if (target.probe.pushedLocalCommits) return ['already-pushed-local-commits']
  if (target.probe.hasUnpushedLocalCommits) return []
  if (!target.probe.aheadBehind) return []

  return target.probe.aheadBehind.ahead === 0 ? ['already-pushed-local-commits'] : []
}

function getRecommendedOriginAction(
  state: SyncRepositoryState,
  warnings: SyncActionWarning[],
): OriginSyncAction {
  if (state === 'missing-remote-branch') return 'push-or-skip'
  if (state === 'fast-forward') return 'fast-forward-origin'
  if (state === 'ahead') return 'push-or-skip'
  if (state === 'diverged') {
    return warnings.includes('already-pushed-local-commits') ? 'merge-origin' : 'rebase-origin'
  }
  return 'skip'
}

function getOriginActions(
  state: SyncRepositoryState,
  recommendedAction: OriginSyncAction,
): OriginSyncAction[] {
  if (state === 'missing-remote-branch') return ['push-or-skip', 'skip', 'cancel']
  if (state === 'fast-forward') return ['fast-forward-origin', 'skip', 'cancel']
  if (state === 'ahead') return ['push-or-skip', 'skip', 'cancel']
  if (state === 'diverged') {
    const first = recommendedAction === 'merge-origin' ? 'merge-origin' : 'rebase-origin'
    const second = first === 'merge-origin' ? 'rebase-origin' : 'merge-origin'
    return [first, second, 'skip', 'cancel']
  }
  return ['skip', 'cancel']
}

function getRecommendedUpstreamAction(
  state: SyncRepositoryState,
  warnings: SyncActionWarning[],
): UpstreamSyncAction {
  if (state === 'missing-remote-branch') return 'choose-upstream-branch'
  if (state === 'fast-forward') return 'fast-forward-upstream'
  if (state === 'ahead') return 'skip'
  if (state === 'diverged') {
    return warnings.includes('already-pushed-local-commits') ? 'merge-upstream' : 'rebase-upstream'
  }
  return 'skip'
}

function getUpstreamActions(
  state: SyncRepositoryState,
  recommendedAction: UpstreamSyncAction,
): UpstreamSyncAction[] {
  if (state === 'missing-remote-branch') return ['choose-upstream-branch', 'skip', 'cancel']
  if (state === 'fast-forward') return ['fast-forward-upstream', 'skip', 'cancel']
  if (state === 'ahead') return ['skip', 'cancel']
  if (state === 'diverged') {
    const first = recommendedAction === 'merge-upstream' ? 'merge-upstream' : 'rebase-upstream'
    const second = first === 'merge-upstream' ? 'rebase-upstream' : 'merge-upstream'
    return [first, second, 'skip', 'cancel']
  }
  return ['skip', 'cancel']
}
