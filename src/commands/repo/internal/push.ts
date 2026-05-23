import type { StatusCheck } from './status.js'

export type PushRepoRole = 'main' | 'backend' | 'frontend'

export interface PushRepositoryProbe {
  role: PushRepoRole
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
}

export interface PushPlanItem {
  role: PushRepoRole
  label: string
  dir: string
  branch: string
  originUrl: string
}

export interface PushPlanIssue {
  role: PushRepoRole
  label: string
  code: string
  message: string
}

export type PushPlanResult =
  | { ok: true; items: PushPlanItem[]; warnings: PushPlanIssue[] }
  | { ok: false; errors: PushPlanIssue[]; warnings: PushPlanIssue[] }

export interface BuildPushPlanOptions {
  gitmodulesErrors?: PushPlanIssue[]
}

export type PushExecutionPhase = 'dry-run' | 'push'
export type PushExecutionState = 'ok' | 'failed' | 'pending'

export interface PushExecutionResult {
  phase: PushExecutionPhase
  item: PushPlanItem
  state: PushExecutionState
}

export interface PushExecutionSummary {
  ok: boolean
  pushed: string[]
  failed: string[]
  pending: string[]
}

export function getPushOrder(): PushRepoRole[] {
  return ['backend', 'frontend', 'main']
}

export function buildPushPlan(
  input: Record<PushRepoRole, PushRepositoryProbe>,
  options: BuildPushPlanOptions = {},
): PushPlanResult {
  const errors: PushPlanIssue[] = [...(options.gitmodulesErrors ?? [])]
  const warnings: PushPlanIssue[] = []

  for (const role of getPushOrder()) {
    assessProbe(input[role], errors, warnings)
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }

  return {
    ok: true,
    warnings,
    items: getPushOrder().map((role) => {
      const probe = input[role]
      return {
        role: probe.role,
        label: probe.label,
        dir: probe.dir,
        branch: probe.currentBranch!,
        originUrl: probe.originUrl!,
      }
    }),
  }
}

export function convertGitmodulesChecksToPushIssues(checks: StatusCheck[]): PushPlanIssue[] {
  return checks
    .filter((check) => check.level !== 'ok')
    .map((check) => ({
      role: 'main',
      label: '.gitmodules',
      code: check.code,
      message: check.message,
    }))
}

export function markDryRunResult(item: PushPlanItem, ok: boolean): PushExecutionResult {
  return {
    phase: 'dry-run',
    item,
    state: ok ? 'ok' : 'failed',
  }
}

export function markPushResult(item: PushPlanItem, ok: boolean | null): PushExecutionResult {
  return {
    phase: 'push',
    item,
    state: ok === null ? 'pending' : ok ? 'ok' : 'failed',
  }
}

export function summarizePushResults(results: PushExecutionResult[]): PushExecutionSummary {
  const hasRealPush = results.some((result) => result.phase === 'push')
  const dryRunFailed = !hasRealPush && results.some((result) => result.state === 'failed')
  const pushed = results
    .filter((result) => result.phase === 'push' && result.state === 'ok')
    .map((result) => result.item.label)
  const failed = results
    .filter((result) => result.state === 'failed')
    .map((result) => result.item.label)
  const pending = results
    .filter((result) => (
      result.state === 'pending' ||
      (dryRunFailed && result.state === 'ok')
    ))
    .map((result) => result.item.label)

  return {
    ok: failed.length === 0 && pending.length === 0,
    pushed,
    failed,
    pending,
  }
}

export async function runDryRunChecks(
  items: readonly PushPlanItem[],
  dryRun: (item: PushPlanItem) => Promise<boolean>,
): Promise<PushExecutionResult[]> {
  const results: PushExecutionResult[] = []
  for (const item of items) {
    results.push(markDryRunResult(item, await dryRun(item)))
  }
  return results
}

export async function runPushSequence(
  items: readonly PushPlanItem[],
  push: (item: PushPlanItem) => Promise<boolean>,
): Promise<PushExecutionResult[]> {
  const results: PushExecutionResult[] = []
  let failed = false

  for (const item of items) {
    if (failed) {
      results.push(markPushResult(item, null))
      continue
    }

    const ok = await push(item)
    results.push(markPushResult(item, ok))
    if (!ok) failed = true
  }

  return results
}

function assessProbe(
  probe: PushRepositoryProbe,
  errors: PushPlanIssue[],
  warnings: PushPlanIssue[],
): void {
  if (!probe.exists) {
    errors.push(issue(probe, `${probe.role}.dir`, `${probe.label} directory is missing`))
    return
  }

  if (!probe.isGitRoot) {
    errors.push(issue(probe, `${probe.role}.gitRoot`, `${probe.label} is not a Git root`))
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

  if (probe.role !== 'main' && probe.isShallow) {
    errors.push(issue(probe, `${probe.role}.shallow`, `${probe.label} is a shallow clone`))
  }

  if (
    probe.role !== 'main' &&
    probe.expectedUpstreamUrl !== undefined &&
    probe.upstreamUrl !== probe.expectedUpstreamUrl
  ) {
    warnings.push(issue(probe, `${probe.role}.upstream`, `${probe.label} upstream does not match official repository`))
  }
}

function issue(probe: PushRepositoryProbe, code: string, message: string): PushPlanIssue {
  return {
    role: probe.role,
    label: probe.label,
    code,
    message,
  }
}
