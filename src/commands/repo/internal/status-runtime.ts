import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveProjectDir } from '../../../lib/config.js'
import { rt } from './text.js'
import { formatErrorMessage } from './display.js'
import { buildProjectStatus } from './status-inspection.js'
import { readStrictProjectConfig } from './project.js'
import {
  type RecommendedStatusAction,
  type StatusCheck,
  type StatusLevel,
} from './status.js'

export interface RepoStatusActionOptions {
  project?: string
  projectDir?: string
}

function statusColor(level: StatusLevel): (value: string) => string {
  if (level === 'ok') return chalk.green
  if (level === 'warn') return chalk.yellow
  return chalk.red
}

function statusMarker(level: StatusLevel): string {
  if (level === 'ok') return 'OK'
  if (level === 'warn') return 'WARN'
  return 'ERROR'
}

function renderCheck(check: StatusCheck): string {
  const color = statusColor(check.level)
  const detail = check.detail ? chalk.dim(` (${check.detail})`) : ''
  return `  ${color(statusMarker(check.level).padEnd(5))} ${check.message}${detail}`
}

function getStatusHint(level: StatusLevel, actions: RecommendedStatusAction[]): string {
  if (level === 'ok') return rt('repoStatusHintOk')
  if (level === 'warn') {
    return actions.includes('init') ? rt('repoStatusHintWarn') : rt('repoStatusHintManual')
  }
  return rt('repoStatusHintError')
}

function printSection(label: string, checks: StatusCheck[]): void {
  console.log()
  console.log(chalk.bold(label))
  for (const check of checks) {
    console.log(renderCheck(check))
  }
}

function isCancelled(value: unknown): boolean {
  return clack.isCancel(value)
}

function getActionLabel(action: RecommendedStatusAction | 'exit'): string {
  if (action === 'init') return rt('repoStatusActionInit')
  if (action === 'sync') return rt('repoStatusActionSync')
  if (action === 'push') return rt('repoStatusActionPush')
  return rt('repoStatusActionExit')
}

function getActionHint(action: RecommendedStatusAction | 'exit'): string | undefined {
  if (action === 'init') return rt('repoStatusActionInitHint')
  if (action === 'sync') return rt('repoStatusActionSyncHint')
  if (action === 'push') return rt('repoStatusActionPushHint')
  return undefined
}

async function promptNextStatusAction(
  actions: RecommendedStatusAction[],
): Promise<RecommendedStatusAction | 'exit' | null> {
  const values: Array<RecommendedStatusAction | 'exit'> = [...actions, 'exit']
  const options = values.map((action) => ({
    value: action,
    label: getActionLabel(action),
    hint: getActionHint(action),
  }))

  const selected = await clack.select<RecommendedStatusAction | 'exit'>({
    message: rt('repoStatusNextActionQuestion'),
    options,
    initialValue: actions[0] ?? 'exit',
  })
  if (typeof selected === 'symbol') {
    clack.cancel(chalk.yellow(rt('repoStatusCancelled')))
    return null
  }

  return selected
}

export async function repoStatusAction(options: RepoStatusActionOptions = {}) {
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

  clack.intro(chalk.bgCyan(' fba-cli repo status '))
  const confirmedProject = await clack.confirm({
    message: `${rt('repoStatusConfirmProject')} ${config.name} (${projectDir})?`,
    initialValue: true,
  })
  if (isCancelled(confirmedProject) || !confirmedProject) {
    clack.cancel(chalk.yellow(rt('repoStatusCancelled')))
    return
  }

  let status: Awaited<ReturnType<typeof buildProjectStatus>>
  try {
    status = await buildProjectStatus(projectDir)
  } catch (error) {
    console.log(chalk.red(formatErrorMessage(error)))
    return
  }

  console.log(chalk.bold(rt('repoStatusTitle')))
  console.log(`${status.config.name} ${chalk.dim(projectDir)}`)
  console.log(`${rt('repoStatusOverall')}: ${statusColor(status.overall)(statusMarker(status.overall))}`)

  printSection(rt('repoInitRoleMain'), status.mainChecks)
  printSection(rt('repoInitRoleBackend'), status.backendChecks)
  printSection(rt('repoInitRoleFrontend'), status.frontendChecks)
  printSection('.gitmodules', status.gitmodulesChecks)

  console.log()
  console.log(chalk.dim(getStatusHint(status.overall, status.recommendedActions)))

  const selectedAction = await promptNextStatusAction(status.recommendedActions)
  if (!selectedAction || selectedAction === 'exit') {
    clack.outro(chalk.green(rt('repoStatusComplete')))
    return
  }

  clack.note(`fba-cli repo ${selectedAction}`, rt('repoStatusNextSteps'))
  clack.outro(chalk.green(rt('repoStatusComplete')))
}
