import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveProjectDir } from '../../../lib/config.js'
import { rt } from './text.js'
import {
  dryRunPushCurrentBranch,
  pushCurrentBranch,
} from './git.js'
import { buildProjectPushPlan } from './push-inspection.js'
import { readStrictProjectConfig } from './project.js'
import {
  runDryRunChecks,
  runPushSequence,
  summarizePushResults,
  type PushPlanIssue,
  type PushPlanItem,
} from './push.js'

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
      `${index + 1}. ${item.label}: ${item.branch} -> ${item.originUrl}`
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
    console.log(chalk.red(error instanceof Error ? error.message : String(error)))
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

  let plan: Awaited<ReturnType<typeof buildProjectPushPlan>>
  try {
    plan = await buildProjectPushPlan(projectDir)
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : String(error)))
    return
  }

  clack.log.info(`${plan.config.name} ${chalk.dim(projectDir)}`)

  if (!plan.result.ok) {
    clack.log.error(chalk.red(rt('repoPushPrecheckFailed')))
    for (const error of plan.result.errors) {
      clack.log.error(chalk.red(renderIssue(error)))
    }
    if (plan.result.warnings.length > 0) {
      for (const warning of plan.result.warnings) {
        clack.log.warn(chalk.yellow(renderIssue(warning)))
      }
    }
    clack.outro(chalk.yellow(rt('repoPushFixHint')))
    return
  }

  const dryRunResults = await runDryRunChecks(plan.result.items, (item) => (
    dryRunPushCurrentBranch(item.dir, item.branch)
  ))
  const dryRunSummary = summarizePushResults(dryRunResults)
  if (!dryRunSummary.ok) {
    clack.log.error(chalk.red(rt('repoPushDryRunFailed')))
    clack.log.error(`${rt('repoPushFailed')}: ${dryRunSummary.failed.join(', ')}`)
    clack.outro(chalk.yellow(rt('repoPushFixHint')))
    return
  }

  const confirmed = await clack.confirm({
    message: renderPushPlan(plan.result.items, plan.result.warnings),
    initialValue: false,
  })
  if (isCancelled(confirmed) || !confirmed) {
    clack.cancel(chalk.yellow(rt('repoPushCancelled')))
    return
  }

  const pushResults = await runPushSequence(plan.result.items, (item) => (
    pushCurrentBranch(item.dir, item.branch)
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
    plan.result.items
      .map((item) => `${item.label}: ${item.branch} -> origin/${item.branch}`)
      .join('\n'),
    rt('repoPushComplete'),
  )
  clack.outro(chalk.green(rt('repoPushStatusHint')))
}
