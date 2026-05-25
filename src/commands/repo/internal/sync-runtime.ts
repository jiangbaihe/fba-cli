import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveProjectDir } from '../../../lib/config.js'
import { rt } from './text.js'
import { formatErrorMessage } from './display.js'
import {
  getAheadBehind,
  getPorcelainStatus,
  getRemoteBranchRef,
  hasSubmodulePointerChange,
} from './git.js'
import { resolveGitHubToken } from './github-token.js'
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
  buildMainRepositoryChangePlan,
  getBlockingSyncPrecheckIssues,
  getLocalSyncPrecheckIssues,
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
  authToken?: string
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
    [plan.config.backend_name, plan.config.frontend_name],
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

function renderPrecheckIssueList(issues: SyncPlanIssue[]): void {
  clack.log.error(chalk.red(rt('repoSyncBlocked')))
  for (const issue of issues) {
    clack.log.error(chalk.red(renderIssue(issue)))
  }
}

function hasOnlyMainPointerPrecheckIssues(plan: ProjectSyncPlan): boolean {
  if (plan.precheck.ok) return false

  const blocking = getBlockingSyncPrecheckIssues(plan.precheck.errors)
  return blocking.length > 0 && blocking.every((issue) => isAllowedMainPointerIssue(issue, plan))
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
  authToken?: string,
): Promise<MainPrecheckRefreshResult> {
  const mainProbe = await inspectMainSyncRepository(projectDir, { authToken })
  const item = getMainOriginPlanItem(mainProbe)
  if (!item) return { result: 'failed', probe: mainProbe }
  if (item.state !== 'fast-forward') {
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

async function handleInitialMainPointerChanges(
  projectDir: string,
  plan: ProjectSyncPlan,
  authToken?: string,
): Promise<{ result: SyncCommandResult | null; plan: ProjectSyncPlan }> {
  if (!hasOnlyMainPointerPrecheckIssues(plan)) {
    return { result: null, plan }
  }

  const pointerResult = await handleMainRepositoryPointerChanges({
    backendName: plan.config.backend_name,
    frontendName: plan.config.frontend_name,
    projectDir,
    isCancelled,
  })
  if (pointerResult !== 'updated') {
    return { result: pointerResult, plan }
  }

  try {
    return {
      result: pointerResult,
      plan: await buildProjectSyncPlan(projectDir, { authToken }),
    }
  } catch (error) {
    console.log(chalk.red(formatErrorMessage(error)))
    return { result: 'failed', plan }
  }
}

async function handleStartupMainPointerChanges(input: {
  projectDir: string
  config: ReturnType<typeof readStrictProjectConfig>
  mainProbe: SyncRepositoryProbe
}): Promise<SyncCommandResult | null> {
  if (!input.mainProbe.isGitRoot || !input.mainProbe.currentBranch) return null

  const status = input.mainProbe.porcelainStatus
  if (!status || status.length === 0) return null

  const changePlan = await buildMainRepositoryChangePlan({
    porcelainStatus: status,
    allowedPaths: [input.config.backend_name, input.config.frontend_name],
    hasPointerChange: (path) => hasSubmodulePointerChange(input.projectDir, path),
  })
  if (changePlan.committablePaths.length === 0 || changePlan.unrelatedLines.length > 0) return null

  return handleMainRepositoryPointerChanges({
    backendName: input.config.backend_name,
    frontendName: input.config.frontend_name,
    projectDir: input.projectDir,
    isCancelled,
  })
}

function isMainPrecheckRefreshAction(action: SyncWizardAction): action is OriginSyncAction {
  return action === 'fast-forward-origin'
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
        currentPlan = await buildProjectSyncPlan(projectDir, { authToken: options.authToken })
      } catch (error) {
        console.log(chalk.red(formatErrorMessage(error)))
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
  authToken?: string,
): Promise<SyncCommandResult[]> {
  clack.log.step(rt('repoSyncUpstreamPhase'))
  const targets = await Promise.all([probes.backend, probes.frontend].map((probe) => (
    inspectUpstreamTarget(probe, { authToken })
  )))
  const fetchFailures = targets.filter((target) => !target.fetchOk)
  const results: SyncCommandResult[] = []
  for (const target of fetchFailures) {
    if (target.probe.upstreamUrl !== target.probe.expectedUpstreamUrl) {
      clack.log.warn(chalk.yellow(`${target.probe.label}: ${rt('repoSyncUpstreamMismatch')}`))
      results.push('skipped')
    } else {
      clack.log.warn(chalk.yellow(`${target.probe.label}: ${rt('repoSyncUpstreamFetchFailed')}`))
      results.push('failed')
    }
  }

  const plan = buildUpstreamSyncPlan(targets.filter((target) => target.fetchOk))

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
      const branchChoice = await chooseUpstreamBranch(item)
      if (branchChoice.status === 'cancelled') {
        results.push('cancelled')
        return results
      }
      if (branchChoice.status === 'skipped') {
        results.push('skipped')
        continue
      }
      const refreshed = await refreshUpstreamItem(item, probes[item.role], branchChoice.branch)
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
        results.push('cancelled')
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

async function getUnresolvedMainPointerResult(
  projectDir: string,
  config: ProjectSyncPlan['config'],
): Promise<SyncCommandResult | null> {
  const porcelainStatus = await getPorcelainStatus(projectDir)
  if (porcelainStatus === null) return 'failed'
  if (porcelainStatus.length === 0) return null

  const changePlan = await buildMainRepositoryChangePlan({
    porcelainStatus,
    allowedPaths: [config.backend_name, config.frontend_name],
    hasPointerChange: (path) => hasSubmodulePointerChange(projectDir, path),
  })
  if (changePlan.committablePaths.length > 0 && changePlan.unrelatedLines.length === 0) {
    clack.note(changePlan.committablePaths.join('\n'), rt('repoSyncMainPointerChanges'))
    return 'stopped'
  }
  if (changePlan.unrelatedLines.length > 0) {
    clack.note(changePlan.unrelatedLines.join('\n'), rt('repoSyncMainUnrelatedChanges'))
    return 'stopped'
  }

  return null
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
    console.log(chalk.red(formatErrorMessage(error)))
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

  const authToken = (await resolveGitHubToken())?.token

  let plan: ProjectSyncPlan
  const precheckRefreshResults: SyncCommandResult[] = []
  const mainPrecheckRefresh = await refreshMainBeforeProjectPrecheck(projectDir, authToken)
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

  const startupPointerResult = precheckRefreshResult === 'updated'
    ? null
    : await handleStartupMainPointerChanges({
      projectDir,
      config,
      mainProbe: mainPrecheckRefresh.probe,
    })
  if (startupPointerResult) {
    if (startupPointerResult === 'updated') {
      precheckRefreshResults.push(startupPointerResult)
    } else {
      printSyncSummary([startupPointerResult])
      clack.outro(chalk.yellow(rt('repoSyncFixHint')))
      return
    }
  }

  if (startupPointerResult !== 'updated') {
    const mainLocalIssues = getLocalSyncPrecheckIssues(mainPrecheckRefresh.probe)
    if (mainLocalIssues.length > 0) {
      renderPrecheckIssueList(mainLocalIssues)
      clack.outro(chalk.yellow(rt('repoSyncFixHint')))
      return
    }
  }

  try {
    plan = await buildProjectSyncPlan(
      projectDir,
      precheckRefreshResult === 'updated' || startupPointerResult === 'updated'
        ? { authToken }
        : { mainProbe: mainPrecheckRefresh.probe, authToken },
    )
  } catch (error) {
    console.log(chalk.red(formatErrorMessage(error)))
    return
  }

  if (!renderPrecheckIssues(plan, { allowMainPointerChanges: precheckRefreshResult === 'updated' })) {
    const pointerPrecheck = await handleInitialMainPointerChanges(projectDir, plan, authToken)
    if (pointerPrecheck.result === 'updated') {
      precheckRefreshResults.push(pointerPrecheck.result)
      plan = pointerPrecheck.plan
      if (!renderPrecheckIssues(plan)) {
        clack.outro(chalk.yellow(rt('repoSyncFixHint')))
        return
      }
    } else {
      if (pointerPrecheck.result) printSyncSummary([pointerPrecheck.result])
      clack.outro(chalk.yellow(rt('repoSyncFixHint')))
      return
    }
  }

  const originPhase = await runOriginPhase(projectDir, plan, {
    skipMainOrigin: precheckRefreshResult === 'skipped',
    authToken,
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

  const unresolvedMainPointerResult = originPhase.childUpdated
    ? null
    : await getUnresolvedMainPointerResult(projectDir, plan.config)
  if (unresolvedMainPointerResult) {
    originResults.push(unresolvedMainPointerResult)
    printSyncSummary(originResults)
    clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
    return
  }

  const followUpstream = await clack.confirm({
    message: rt('repoSyncFollowUpstreamQuestion'),
    initialValue: true,
  })
  if (isCancelled(followUpstream)) {
    printSyncSummary(originResults)
    clack.cancel(chalk.yellow(rt('repoSyncCancelled')))
    clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
    return
  }

  const upstreamResults = followUpstream ? await runUpstreamPhase(plan.probes, plan.config, projectDir, authToken) : []
  const allResults = [...originResults, ...upstreamResults]
  printSyncSummary(allResults)

  if (allResults.some((result) => result === 'failed' || result === 'stopped' || result === 'cancelled')) {
    clack.outro(chalk.yellow(rt('repoSyncRetryHint')))
    return
  }

  clack.outro(chalk.green(rt('repoSyncStatusHint')))
}
