import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveProjectDir } from '../../../lib/config.js'
import { rt } from './text.js'
import {
  getAheadBehind,
  getRemoteBranchRef,
} from './git.js'
import {
  buildProjectSyncPlan,
  inspectMainSyncRepository,
  inspectUpstreamTarget,
  type ProjectSyncPlan,
} from './sync-inspection.js'
import {
  applySyncOperation,
  handleMainRepositoryPointerChanges,
  type SyncCommandResult,
} from './sync-operations.js'
import {
  chooseUpstreamBranch,
  isCancelled,
  promptChosenUpstreamAction,
  promptSyncAction,
} from './sync-prompts.js'
import { readStrictProjectConfig } from './project.js'
import {
  buildOriginSyncPlan,
  buildUpstreamSyncPlan,
  getBlockingSyncPrecheckIssues,
  getMainRepositoryChangePlan,
  type OriginSyncPlanItem,
  type OriginSyncAction,
  type SyncPlanIssue,
  type SyncRepoRole,
  type SyncRepositoryProbe,
  type SyncWizardAction,
  type UpstreamSyncPlanItem,
} from './sync.js'

export interface RepoSyncActionOptions {
  project?: string
  projectDir?: string
}

interface OriginPhaseResult {
  results: SyncCommandResult[]
  childUpdated: boolean
  plan: ProjectSyncPlan
}

interface RunOriginPhaseOptions {
  skipMainOrigin?: boolean
}

function renderIssue(issue: SyncPlanIssue): string {
  return `${issue.label}: ${issue.message}`
}

function isAllowedMainPointerIssue(issue: SyncPlanIssue, plan: ProjectSyncPlan): boolean {
  if (issue.code !== 'main.workingTree') return false
  const status = plan.probes.main.porcelainStatus
  if (!status) return false

  const changePlan = getMainRepositoryChangePlan(
    status,
    ['.gitmodules', plan.config.backend_name, plan.config.frontend_name],
  )
  return changePlan.unrelatedLines.length === 0
}

function renderPrecheckIssues(plan: ProjectSyncPlan, options: { allowMainPointerChanges?: boolean } = {}): boolean {
  if (plan.precheck.ok) return true

  const blocking = getBlockingSyncPrecheckIssues(plan.precheck.errors)
    .filter((issue) => !(options.allowMainPointerChanges && isAllowedMainPointerIssue(issue, plan)))
  if (blocking.length === 0) return true

  clack.log.error(chalk.red(rt('repoSyncBlocked')))
  for (const error of blocking) {
    clack.log.error(chalk.red(renderIssue(error)))
  }
  if (plan.precheck.warnings.length > 0) {
    for (const warning of plan.precheck.warnings) {
      clack.log.warn(chalk.yellow(renderIssue(warning)))
    }
  }
  return false
}

function getMainOriginPlanItem(probe: SyncRepositoryProbe): OriginSyncPlanItem | null {
  return buildOriginSyncPlan([{
    probe,
    remoteBranchRef: probe.remoteBranchRef && probe.currentBranch ? `origin/${probe.currentBranch}` : null,
    aheadBehind: probe.aheadBehind,
  }]).find((item) => item.role === 'main') ?? null
}

interface MainPrecheckRefreshResult {
  result: SyncCommandResult | null
  probe: SyncRepositoryProbe
}

async function refreshMainBeforeProjectPrecheck(
  projectDir: string,
): Promise<MainPrecheckRefreshResult> {
  const mainProbe = await inspectMainSyncRepository(projectDir)
  const item = getMainOriginPlanItem(mainProbe)
  if (!item) return { result: 'failed', probe: mainProbe }
  if (item.state !== 'fast-forward' && item.state !== 'diverged') {
    return { result: null, probe: mainProbe }
  }

  clack.log.warn(chalk.yellow(rt('repoSyncMainMayRefreshProjectMetadata')))
  const action = await promptSyncAction(item, 'origin')
  if (!action || action === 'cancel') return { result: 'cancelled', probe: mainProbe }
  if (!isMainPrecheckRefreshAction(action)) return { result: 'skipped', probe: mainProbe }

  return {
    result: await applySyncOperation({
      dir: item.dir,
      label: item.label,
      action,
      targetRef: item.targetRef,
      isCancelled,
    }),
    probe: mainProbe,
  }
}

function isMainPrecheckRefreshAction(action: SyncWizardAction): action is OriginSyncAction {
  return action === 'fast-forward-origin'
    || action === 'merge-origin'
    || action === 'rebase-origin'
}

async function runOriginPhase(
  projectDir: string,
  initialPlan: ProjectSyncPlan,
  options: RunOriginPhaseOptions = {},
): Promise<OriginPhaseResult> {
  clack.log.step(rt('repoSyncOriginPhase'))
  const results: SyncCommandResult[] = []
  let childUpdated = false
  let currentPlan = initialPlan

  for (const role of ['main', 'backend', 'frontend'] as const) {
    const item = buildOriginSyncPlan(Object.values(currentPlan.probes).map((probe) => ({
      probe,
      remoteBranchRef: probe.remoteBranchRef && probe.currentBranch ? `origin/${probe.currentBranch}` : null,
      aheadBehind: probe.aheadBehind,
    }))).find((candidate) => candidate.role === role)
    if (!item) continue

    if (role === 'main' && options.skipMainOrigin) {
      clack.log.info(`${item.label}: ${rt('repoSyncSkipped')}`)
      results.push('skipped')
      continue
    }

    if (item.state === 'up-to-date') {
      clack.log.info(`${item.label}: ${rt('repoSyncSkipped')}`)
      results.push('skipped')
      continue
    }

    const action = await promptSyncAction(item, 'origin')
    if (!action || action === 'cancel') {
      results.push('cancelled')
      return { results, childUpdated, plan: currentPlan }
    }

    const result = await applySyncOperation({
      dir: item.dir,
      label: item.label,
      action,
      targetRef: item.targetRef,
      isCancelled,
    })
    results.push(result)
    if (result === 'updated' && (item.role === 'backend' || item.role === 'frontend')) {
      childUpdated = true
    }
    if (result === 'failed' || result === 'stopped' || result === 'cancelled') {
      return { results, childUpdated, plan: currentPlan }
    }
    if (result === 'updated' && item.role === 'main') {
      try {
        currentPlan = await buildProjectSyncPlan(projectDir)
      } catch (error) {
        console.log(chalk.red(error instanceof Error ? error.message : String(error)))
        results.push('failed')
        return { results, childUpdated, plan: currentPlan }
      }

      if (!renderPrecheckIssues(currentPlan, { allowMainPointerChanges: true })) {
        results.push('stopped')
        return { results, childUpdated, plan: currentPlan }
      }
    }
  }

  return { results, childUpdated, plan: currentPlan }
}

async function refreshUpstreamItem(
  item: UpstreamSyncPlanItem,
  probe: SyncRepositoryProbe,
  branch: string,
): Promise<UpstreamSyncPlanItem | null> {
  const remoteBranchRef = await getRemoteBranchRef(item.dir, branch, 'upstream')
  if (!remoteBranchRef) return null

  const aheadBehind = await getAheadBehind(item.dir, 'HEAD', `upstream/${branch}`)
  return buildUpstreamSyncPlan([{
    probe: {
      ...probe,
      remoteBranchRef,
    },
    remoteBranchRef: `upstream/${branch}`,
    upstreamBranch: branch,
    aheadBehind,
    availableBranches: item.availableBranches,
  }])[0] ?? null
}

async function runUpstreamPhase(
  probes: Record<SyncRepoRole, SyncRepositoryProbe>,
  config: ProjectSyncPlan['config'],
  projectDir: string,
): Promise<SyncCommandResult[]> {
  clack.log.step(rt('repoSyncUpstreamPhase'))
  const targets = await Promise.all([probes.backend, probes.frontend].map(inspectUpstreamTarget))
  const fetchFailures = targets.filter((target) => !target.fetchOk)
  for (const target of fetchFailures) {
    if (target.probe.upstreamUrl !== target.probe.expectedUpstreamUrl) {
      clack.log.warn(chalk.yellow(`${target.probe.label}: ${rt('repoSyncUpstreamMismatch')}`))
    } else {
      clack.log.warn(chalk.yellow(`${target.probe.label}: ${rt('repoSyncUpstreamFetchFailed')}`))
    }
  }

  const plan = buildUpstreamSyncPlan(targets.filter((target) => target.fetchOk))
  const results: SyncCommandResult[] = []

  for (let item of plan) {
    if (item.state === 'up-to-date') {
      clack.log.info(`${item.label}: ${rt('repoSyncSkipped')}`)
      results.push('skipped')
      continue
    }
    if (item.state === 'ahead') {
      clack.log.info(`${item.label}: ${rt('repoSyncUpstreamNoIncomingUpdates')}`)
      results.push('skipped')
      continue
    }

    const action = await promptSyncAction(item, 'upstream')
    if (!action || action === 'cancel') {
      results.push('cancelled')
      return results
    }

    if (action === 'choose-upstream-branch') {
      const branch = await chooseUpstreamBranch(item)
      if (!branch) {
        results.push('skipped')
        continue
      }
      const refreshed = await refreshUpstreamItem(item, probes[item.role], branch)
      if (!refreshed) {
        results.push('failed')
        return results
      }
      item = refreshed
      if (item.state === 'up-to-date') {
        clack.log.info(`${item.label}: ${rt('repoSyncSkipped')}`)
        results.push('skipped')
        continue
      }
      if (item.state === 'ahead') {
        clack.log.info(`${item.label}: ${rt('repoSyncUpstreamNoIncomingUpdates')}`)
        results.push('skipped')
        continue
      }
      const nextAction = await promptChosenUpstreamAction(item)
      if (!nextAction || nextAction === 'cancel') {
        results.push(nextAction === 'cancel' ? 'cancelled' : 'skipped')
        return results
      }
      const result = await applySyncOperation({
        dir: item.dir,
        label: item.label,
        action: nextAction,
        targetRef: item.targetRef,
        isCancelled,
      })
      results.push(result)
      if (result === 'failed' || result === 'stopped' || result === 'cancelled') return results
      continue
    }

    const result = await applySyncOperation({
      dir: item.dir,
      label: item.label,
      action,
      targetRef: item.targetRef,
      isCancelled,
    })
    results.push(result)
    if (result === 'failed' || result === 'stopped' || result === 'cancelled') return results
  }

  if (results.includes('updated')) {
    const pointerResult = await handleMainRepositoryPointerChanges({
      backendName: config.backend_name,
      frontendName: config.frontend_name,
      projectDir,
      isCancelled,
    })
    if (pointerResult !== 'skipped') results.push(pointerResult)
  }

  return results
}

function printSyncSummary(results: SyncCommandResult[]): void {
  const updated = results.filter((result) => result === 'updated').length
  const skipped = results.filter((result) => result === 'skipped').length
  const failed = results.filter((result) => result === 'failed').length
  const stopped = results.filter((result) => result === 'stopped' || result === 'cancelled').length

  clack.note([
    `${rt('repoSyncUpdated')}: ${updated}`,
    `${rt('repoSyncSkipped')}: ${skipped}`,
    failed > 0 ? `${rt('repoSyncFailed')}: ${failed}` : '',
    stopped > 0 ? `${rt('repoSyncPending')}: ${stopped}` : '',
  ].filter(Boolean).join('\n'), rt('repoSyncComplete'))
}

export async function repoSyncAction(options: RepoSyncActionOptions = {}) {
  const projectDir = options.projectDir ?? resolveProjectDir(options.project)
  if (!projectDir || !existsSync(join(projectDir, '.fba.json'))) {
    console.log(chalk.red(rt('useNotFbaProject')))
    console.log(chalk.dim(rt('repoInitProjectHint')))
    return
  }

  clack.intro(chalk.bgCyan(' fba-cli repo sync '))

  let config: ReturnType<typeof readStrictProjectConfig>
  try {
    config = readStrictProjectConfig(projectDir)
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : String(error)))
    return
  }

  const confirmedProject = await clack.confirm({
    message: `${rt('repoSyncConfirmProject')} ${config.name} (${projectDir})?`,
    initialValue: true,
  })
  if (isCancelled(confirmedProject) || !confirmedProject) {
    clack.cancel(chalk.yellow(rt('repoSyncCancelled')))
    return
  }

  let plan: ProjectSyncPlan
  const precheckRefreshResults: SyncCommandResult[] = []
  const mainPrecheckRefresh = await refreshMainBeforeProjectPrecheck(projectDir)
  const precheckRefreshResult = mainPrecheckRefresh.result
  if (precheckRefreshResult) {
    if (precheckRefreshResult === 'updated') {
      precheckRefreshResults.push(precheckRefreshResult)
    } else if (precheckRefreshResult !== 'skipped') {
      printSyncSummary([precheckRefreshResult])
      clack.outro(chalk.yellow(rt('repoSyncFixHint')))
      return
    }
  }

  try {
    plan = await buildProjectSyncPlan(
      projectDir,
      precheckRefreshResult === 'updated'
        ? {}
        : { mainProbe: mainPrecheckRefresh.probe },
    )
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : String(error)))
    return
  }

  if (!renderPrecheckIssues(plan, { allowMainPointerChanges: precheckRefreshResult === 'updated' })) {
    clack.outro(chalk.yellow(rt('repoSyncFixHint')))
    return
  }

  const originPhase = await runOriginPhase(projectDir, plan, {
    skipMainOrigin: precheckRefreshResult === 'skipped',
  })
  plan = originPhase.plan
  const originResults = [...precheckRefreshResults, ...originPhase.results]
  if (originResults.some((result) => result === 'failed' || result === 'stopped' || result === 'cancelled')) {
    printSyncSummary(originResults)
    clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
    return
  }

  if (originPhase.childUpdated) {
    const originPointerResult = await handleMainRepositoryPointerChanges({
      backendName: plan.config.backend_name,
      frontendName: plan.config.frontend_name,
      projectDir,
      isCancelled,
    })
    if (originPointerResult !== 'skipped') originResults.push(originPointerResult)
    if (originPointerResult === 'failed' || originPointerResult === 'stopped' || originPointerResult === 'cancelled') {
      printSyncSummary(originResults)
      clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
      return
    }
  }

  const followUpstream = await clack.confirm({
    message: rt('repoSyncFollowUpstreamQuestion'),
    initialValue: true,
  })
  if (isCancelled(followUpstream)) {
    clack.cancel(chalk.yellow(rt('repoSyncCancelled')))
    return
  }

  const upstreamResults = followUpstream ? await runUpstreamPhase(plan.probes, plan.config, projectDir) : []
  const allResults = [...originResults, ...upstreamResults]
  printSyncSummary(allResults)

  if (allResults.some((result) => result === 'failed' || result === 'stopped' || result === 'cancelled')) {
    clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
    return
  }

  clack.outro(chalk.green(rt('repoSyncStatusHint')))
}
