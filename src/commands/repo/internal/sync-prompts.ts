import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { rt } from './text.js'
import {
  type OriginSyncPlanItem,
  type SyncRepositoryState,
  type SyncWizardAction,
  type UpstreamSyncPlanItem,
} from './sync.js'

export type SyncPhase = 'origin' | 'upstream'

export function isCancelled(value: unknown): boolean {
  return clack.isCancel(value) || typeof value === 'symbol'
}

function getActionLabel(action: SyncWizardAction): string {
  if (action === 'fast-forward-origin') return rt('repoSyncActionFastForwardOrigin')
  if (action === 'rebase-origin') return rt('repoSyncActionRebaseOrigin')
  if (action === 'merge-origin') return rt('repoSyncActionMergeOrigin')
  if (action === 'push-or-skip') return rt('repoSyncActionPushOrSkip')
  if (action === 'fast-forward-upstream') return rt('repoSyncActionFastForwardUpstream')
  if (action === 'rebase-upstream') return rt('repoSyncActionRebaseUpstream')
  if (action === 'merge-upstream') return rt('repoSyncActionMergeUpstream')
  if (action === 'choose-upstream-branch') return rt('repoSyncActionChooseUpstreamBranch')
  if (action === 'skip') return rt('repoSyncActionSkip')
  return rt('repoSyncActionCancel')
}

function getActionHint(action: SyncWizardAction): string | undefined {
  if (action.includes('rebase')) return rt('repoSyncActionRebaseHint')
  if (action.includes('merge')) return rt('repoSyncActionMergeHint')
  if (action.includes('fast-forward')) return rt('repoSyncActionFastForwardHint')
  if (action === 'push-or-skip') return rt('repoSyncActionPushOrSkipHint')
  return undefined
}

function getStateLabel(state: SyncRepositoryState): string {
  if (state === 'up-to-date') return rt('repoSyncStateUpToDate')
  if (state === 'fast-forward') return rt('repoSyncStateFastForward')
  if (state === 'ahead') return rt('repoSyncStateAhead')
  if (state === 'diverged') return rt('repoSyncStateDiverged')
  if (state === 'missing-remote-branch') return rt('repoSyncStateMissingRemoteBranch')
  return rt('repoSyncStateUnknown')
}

function formatRecommendedAction(item: OriginSyncPlanItem | UpstreamSyncPlanItem): string {
  const target = item.targetRef ? ` (${rt('repoSyncTarget')}: ${item.targetRef})` : ''
  return `${rt('repoSyncRecommendedAction')}: ${getActionLabel(item.recommendedAction)}${target}`
}

export async function promptSyncAction(
  item: OriginSyncPlanItem | UpstreamSyncPlanItem,
  phase: SyncPhase,
): Promise<SyncWizardAction | null> {
  clack.note(
    [
      item.label,
      formatRecommendedAction(item),
      `${rt('repoSyncState')}: ${getStateLabel(item.state)}`,
      item.warnings.includes('already-pushed-local-commits')
        ? rt('repoSyncRebasePublishedWarning')
        : '',
    ].filter(Boolean).join('\n'),
    phase === 'origin' ? rt('repoSyncOriginPhase') : rt('repoSyncUpstreamPhase'),
  )

  const selected = await clack.select<SyncWizardAction>({
    message: `${item.label}: ${rt('repoSyncChooseAction')}`,
    options: item.actions.map((action) => ({
      value: action,
      label: getActionLabel(action),
      hint: getActionHint(action),
    })),
    initialValue: item.recommendedAction,
  })
  if (isCancelled(selected)) {
    clack.cancel(chalk.yellow(rt('repoSyncCancelled')))
    return null
  }

  return selected as SyncWizardAction
}

export async function chooseUpstreamBranch(item: UpstreamSyncPlanItem): Promise<string | null> {
  if (item.availableBranches.length === 0) return null

  const selected = await clack.select<string>({
    message: `${item.label}: ${rt('repoSyncChooseUpstreamBranch')}`,
    options: item.availableBranches.map((branch) => ({
      value: branch,
      label: branch,
    })),
    initialValue: item.availableBranches[0],
  })
  if (isCancelled(selected)) return null
  return selected as string
}

export async function promptChosenUpstreamAction(item: UpstreamSyncPlanItem): Promise<SyncWizardAction | null> {
  if (item.state === 'up-to-date') {
    clack.log.info(`${item.label}: ${rt('repoSyncSkipped')}`)
    return 'skip'
  }
  if (item.state === 'ahead') {
    clack.log.info(`${item.label}: ${rt('repoSyncUpstreamNoIncomingUpdates')}`)
    return 'skip'
  }

  return promptSyncAction(item, 'upstream')
}
