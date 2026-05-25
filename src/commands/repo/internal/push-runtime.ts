import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveProjectDir } from '../../../lib/config.js'
import { formatErrorMessage, redactUrlCredentials } from './display.js'
import { resolveGitHubToken } from './github-token.js'
import { rt } from './text.js'
import {
  commitWithMessage,
  dryRunPushCurrentBranch,
  fetchRemote,
  getHeadCommit,
  getPorcelainStatus,
  getSubmoduleCommitsInMainRange,
  hasSubmodulePointerChange,
  isCommitOnHead,
  isCommitPushed,
  pushCurrentBranch,
  stagePaths,
  unstagePaths,
} from './git.js'
import { buildProjectPushPlan } from './push-inspection.js'
import { readStrictProjectConfig } from './project.js'
import {
  buildPushPlanForRoles,
  getSelectablePushItems,
  runDryRunChecks,
  runPushSequence,
  summarizePushResults,
  type PushPlanIssue,
  type PushPlanItem,
  type PushRepoRole,
} from './push.js'
import { buildMainRepositoryChangePlan } from './sync.js'

export interface RepoPushActionOptions {
  project?: string
  projectDir?: string
}

function isCancelled(value: unknown): boolean {
  return clack.isCancel(value)
}

function renderIssue(issue: PushPlanIssue): string {
  return `${issue.label}: ${issue.message}`
}

function renderPushPlan(items: PushPlanItem[], warnings: PushPlanIssue[]): string {
  const lines = [
    rt('repoPushPlanTitle'),
    ...items.map((item, index) => (
      `${index + 1}. ${item.label}: ${item.branch} -> ${redactUrlCredentials(item.originUrl)}`
    )),
    '',
    rt('repoPushNoHiddenActions'),
  ]

  if (warnings.length > 0) {
    lines.push('', rt('repoPushWarnings'))
    lines.push(...warnings.map((warning) => `- ${renderIssue(warning)}`))
  }

  return lines.join('\n')
}

async function maybeCommitMainPointerChanges(
  projectDir: string,
  config: ReturnType<typeof readStrictProjectConfig>,
  selectedRoles: readonly PushRepoRole[],
  authToken?: string,
): Promise<'committed' | 'skipped' | 'clean' | 'blocked' | 'cancelled'> {
  const porcelainStatus = await getPorcelainStatus(projectDir)
  if (porcelainStatus === null || porcelainStatus.length === 0) return 'clean'

  const changePlan = await buildMainRepositoryChangePlan({
    porcelainStatus,
    allowedPaths: [config.backend_name, config.frontend_name],
    hasPointerChange: (path) => hasSubmodulePointerChange(projectDir, path),
  })
  if (changePlan.committablePaths.length === 0 && changePlan.unrelatedLines.length === 0) return 'clean'

  if (changePlan.unrelatedLines.length > 0) {
    clack.note(changePlan.unrelatedLines.join('\n'), rt('repoPushPointerUnrelatedChanges'))
    return 'blocked'
  }

  const selected = new Set(selectedRoles)
  for (const path of changePlan.committablePaths) {
    const role: PushRepoRole | null = (() => {
      if (path === config.backend_name) return 'backend'
      if (path === config.frontend_name) return 'frontend'
      return null
    })()
    if (!role || selected.has(role)) continue

    const childDir = join(projectDir, path)
    const fetched = authToken
      ? await fetchRemote(childDir, 'origin', { authToken })
      : await fetchRemote(childDir, 'origin')
    const childHead = fetched ? await getHeadCommit(childDir) : null
    const safe = childHead ? await isCommitPushed(projectDir, path, childHead) : null
    if (safe !== true) {
      clack.log.warn(chalk.yellow(rt('repoPushPointerRequiresChildPush')))
      clack.log.warn(chalk.yellow(rt('repoPushPointerSkipped')))
      return 'skipped'
    }
  }

  clack.note(changePlan.committablePaths.join('\n'), rt('repoSyncMainPointerChanges'))
  const confirmed = await clack.confirm({
    message: rt('repoPushPointerCommitQuestion'),
    initialValue: true,
  })
  if (isCancelled(confirmed)) return 'cancelled'
  if (!confirmed) {
    clack.log.warn(chalk.yellow(rt('repoPushPointerSkipped')))
    return 'skipped'
  }

  if (!(await stagePaths(projectDir, changePlan.committablePaths))) {
    clack.log.error(chalk.red(rt('repoPushPointerCommitFailed')))
    return 'blocked'
  }
  if (!(await commitWithMessage(projectDir, 'chore: update submodule refs'))) {
    await unstagePaths(projectDir, changePlan.committablePaths)
    clack.log.error(chalk.red(rt('repoPushPointerCommitFailed')))
    return 'blocked'
  }
  return 'committed'
}

async function promptPushTargets(items: PushPlanItem[]): Promise<PushPlanItem[] | null> {
  const selected = await clack.multiselect({
    message: rt('repoPushChooseTargets'),
    required: true,
    options: items.map((item) => ({
      value: item.role,
      label: `${item.label}: ${item.branch} -> origin/${item.branch}`,
    })),
    initialValues: items.map((item) => item.role),
  }) as PushRepoRole[] | symbol

  if (isCancelled(selected)) return null

  const selectedItems = getSelectablePushItems(items, selected as PushRepoRole[])
  if (selectedItems.length === 0) {
    clack.cancel(chalk.yellow(rt('repoPushNoTargets')))
    return null
  }
  return selectedItems
}

async function checkSelectedMainSubmoduleRefs(
  projectDir: string,
  config: ReturnType<typeof readStrictProjectConfig>,
  mainBranch: string,
  selectedRoles: readonly PushRepoRole[],
  authToken?: string,
): Promise<boolean> {
  if (!selectedRoles.includes('main')) return true
  const childPaths = [config.backend_name, config.frontend_name]
  const mainFetched = authToken
    ? await fetchRemote(projectDir, 'origin', { authToken })
    : await fetchRemote(projectDir, 'origin')
  if (!mainFetched) {
    clack.note(rt('repoInitRoleMain'), rt('repoPushUnpushedSubmoduleRefs'))
    clack.log.error(chalk.red(rt('repoPushMainRequiresPushedSubmodules')))
    return false
  }

  const refs = await getSubmoduleCommitsInMainRange(projectDir, mainBranch, childPaths)
  if (!refs) {
    clack.note(childPaths.join('\n'), rt('repoPushUnpushedSubmoduleRefs'))
    clack.log.error(chalk.red(rt('repoPushMainRequiresPushedSubmodules')))
    return false
  }
  if (Object.values(refs).every((commits) => commits.length === 0)) return true

  const selected = new Set(selectedRoles)
  const missing: string[] = []

  for (const child of [
    { role: 'backend' as const, path: config.backend_name, dir: join(projectDir, config.backend_name) },
    { role: 'frontend' as const, path: config.frontend_name, dir: join(projectDir, config.frontend_name) },
  ]) {
    const commits = refs[child.path] ?? []
    if (commits.length === 0) continue

    const fetched = selected.has(child.role)
      ? true
      : authToken
        ? await fetchRemote(child.dir, 'origin', { authToken })
        : await fetchRemote(child.dir, 'origin')
    if (!fetched) {
      missing.push(child.path)
      continue
    }

    for (const commit of commits) {
      const safe = selected.has(child.role)
        ? await isCommitOnHead(projectDir, child.path, commit)
        : await isCommitPushed(projectDir, child.path, commit)
      if (safe !== true) {
        missing.push(child.path)
        break
      }
    }
  }

  if (missing.length === 0) return true

  clack.note(missing.join('\n'), rt('repoPushUnpushedSubmoduleRefs'))
  clack.log.error(chalk.red(rt('repoPushMainRequiresPushedSubmodules')))
  return false
}

export async function repoPushAction(options: RepoPushActionOptions = {}) {
  const projectDir = options.projectDir ?? resolveProjectDir(options.project)
  if (!projectDir || !existsSync(join(projectDir, '.fba.json'))) {
    console.log(chalk.red(rt('useNotFbaProject')))
    console.log(chalk.dim(rt('repoInitProjectHint')))
    return
  }

  let config: ReturnType<typeof readStrictProjectConfig>
  try {
    config = readStrictProjectConfig(projectDir)
  } catch (error) {
    console.log(chalk.red(formatErrorMessage(error)))
    return
  }

  clack.intro(chalk.bgCyan(' fba-cli repo push '))
  const confirmedProject = await clack.confirm({
    message: `${rt('repoPushConfirmProject')} ${config.name} (${projectDir})?`,
    initialValue: true,
  })
  if (isCancelled(confirmedProject) || !confirmedProject) {
    clack.cancel(chalk.yellow(rt('repoPushCancelled')))
    return
  }

  const authToken = (await resolveGitHubToken())?.token

  let plan: Awaited<ReturnType<typeof buildProjectPushPlan>>
  try {
    plan = await buildProjectPushPlan(projectDir)
  } catch (error) {
    console.log(chalk.red(formatErrorMessage(error)))
    return
  }

  clack.log.info(`${plan.config.name} ${chalk.dim(projectDir)}`)

  if (plan.selectableItems.length === 0) {
    clack.log.error(chalk.red(rt('repoPushPrecheckFailed')))
    if (!plan.result.ok) {
      for (const error of plan.result.errors) {
        clack.log.error(chalk.red(renderIssue(error)))
      }
    }
    clack.outro(chalk.yellow(rt('repoPushFixHint')))
    return
  }

  let selectedItems = await promptPushTargets(plan.selectableItems)
  if (!selectedItems) return
  const selectedRoles = selectedItems.map((item) => item.role)

  let selectedPlan = buildPushPlanForRoles(plan.probes, selectedRoles, plan.options)
  if (!selectedPlan.ok) {
    clack.log.error(chalk.red(rt('repoPushPrecheckFailed')))
    for (const error of selectedPlan.errors) {
      clack.log.error(chalk.red(renderIssue(error)))
    }
    if (selectedPlan.warnings.length > 0) {
      for (const warning of selectedPlan.warnings) {
        clack.log.warn(chalk.yellow(renderIssue(warning)))
      }
    }
    clack.outro(chalk.yellow(rt('repoPushFixHint')))
    return
  }

  if (selectedItems.some((item) => item.role === 'main')) {
    const pointerResult = await maybeCommitMainPointerChanges(projectDir, config, selectedRoles, authToken)
    if (pointerResult === 'cancelled') {
      clack.cancel(chalk.yellow(rt('repoPushCancelled')))
      return
    }
    if (pointerResult === 'blocked') {
      clack.outro(chalk.yellow(rt('repoPushFixHint')))
      return
    }
    if (pointerResult === 'committed') {
      try {
        plan = await buildProjectPushPlan(projectDir)
      } catch (error) {
        console.log(chalk.red(formatErrorMessage(error)))
        return
      }
      selectedPlan = buildPushPlanForRoles(plan.probes, selectedRoles, plan.options)
      if (!selectedPlan.ok) {
        clack.log.error(chalk.red(rt('repoPushPrecheckFailed')))
        for (const error of selectedPlan.errors) {
          clack.log.error(chalk.red(renderIssue(error)))
        }
        clack.outro(chalk.yellow(rt('repoPushFixHint')))
        return
      }
      selectedItems = selectedPlan.items
    }

    const mainItem = selectedItems.find((item) => item.role === 'main')
    if (mainItem && !(await checkSelectedMainSubmoduleRefs(projectDir, config, mainItem.branch, selectedRoles, authToken))) {
      clack.outro(chalk.yellow(rt('repoPushFixHint')))
      return
    }
  }

  const dryRunResults = await runDryRunChecks(selectedItems, (item) => (
    authToken
      ? dryRunPushCurrentBranch(item.dir, item.branch, { authToken })
      : dryRunPushCurrentBranch(item.dir, item.branch)
  ))
  const dryRunSummary = summarizePushResults(dryRunResults)
  if (!dryRunSummary.ok) {
    clack.log.error(chalk.red(rt('repoPushDryRunFailed')))
    clack.log.error(`${rt('repoPushFailed')}: ${dryRunSummary.failed.join(', ')}`)
    clack.outro(chalk.yellow(rt('repoPushFixHint')))
    return
  }

  const confirmed = await clack.confirm({
    message: renderPushPlan(selectedItems, selectedPlan.warnings),
    initialValue: false,
  })
  if (isCancelled(confirmed) || !confirmed) {
    clack.cancel(chalk.yellow(rt('repoPushCancelled')))
    return
  }

  const pushResults = await runPushSequence(selectedItems, (item) => (
    authToken
      ? pushCurrentBranch(item.dir, item.branch, { authToken })
      : pushCurrentBranch(item.dir, item.branch)
  ))
  const pushSummary = summarizePushResults(pushResults)
  if (!pushSummary.ok) {
    clack.log.error(chalk.red(rt('repoPushFailed')))
    if (pushSummary.pushed.length > 0) {
      clack.log.info(`${rt('repoPushAlreadyPushed')}: ${pushSummary.pushed.join(', ')}`)
    }
    if (pushSummary.failed.length > 0) {
      clack.log.error(`${rt('repoPushFailed')}: ${pushSummary.failed.join(', ')}`)
    }
    if (pushSummary.pending.length > 0) {
      clack.log.warn(`${rt('repoPushPending')}: ${pushSummary.pending.join(', ')}`)
    }
    clack.outro(chalk.yellow(rt('repoPushRetryHint')))
    return
  }

  clack.note(
    selectedItems
      .map((item) => `${item.label}: ${item.branch} -> origin/${item.branch}`)
      .join('\n'),
    rt('repoPushComplete'),
  )
  clack.outro(chalk.green(rt('repoPushStatusHint')))
}
