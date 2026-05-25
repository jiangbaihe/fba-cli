import * as clack from '@clack/prompts'
import { rt } from './text.js'
import {
  abortMerge,
  abortRebase,
  checkoutConflictSide,
  commitNoEdit,
  continueRebase,
  getConflictedPaths,
  stagePaths,
} from './git.js'

export type ConflictOperation = 'merge' | 'rebase'
export type ConflictChoice = 'local' | 'incoming' | 'manual' | 'abort'
export type ConflictCommandResult = 'updated' | 'skipped' | 'failed' | 'stopped' | 'cancelled'

export function mapConflictChoiceToGitSide(
  operation: ConflictOperation,
  choice: Extract<ConflictChoice, 'local' | 'incoming'>,
): 'ours' | 'theirs' {
  if (operation === 'merge') return choice === 'local' ? 'ours' : 'theirs'
  return choice === 'local' ? 'theirs' : 'ours'
}

function getManualRecoveryCommands(dir: string, operation: ConflictOperation): string[] {
  return [
    `git -C ${dir} status`,
    operation === 'rebase'
      ? `git -C ${dir} rebase --continue`
      : `git -C ${dir} commit --no-edit`,
    operation === 'rebase'
      ? `git -C ${dir} rebase --abort`
      : `git -C ${dir} merge --abort`,
  ]
}

function printManualRecoveryCommands(dir: string, operation: ConflictOperation): void {
  clack.note(
    getManualRecoveryCommands(dir, operation).join('\n'),
    rt('repoSyncManualHint'),
  )
}

export async function handleConflict(input: {
  dir: string
  label: string
  operation: ConflictOperation
  isCancelled: (value: unknown) => boolean
}): Promise<ConflictCommandResult> {
  const conflicts = await getConflictedPaths(input.dir)
  clack.note(
    conflicts.length > 0 ? conflicts.join('\n') : rt('repoSyncConflictUnknownFiles'),
    `${input.label}: ${rt('repoSyncConflictTitle')}`,
  )

  const choice = await clack.select<ConflictChoice>({
    message: rt('repoSyncConflictQuestion'),
    options: (['local', 'incoming', 'manual', 'abort'] as const).map((value) => ({
      value,
      label: getConflictChoiceLabel(value),
      hint: getConflictChoiceHint(value),
    })),
    initialValue: 'manual',
  })
  if (input.isCancelled(choice)) {
    printManualRecoveryCommands(input.dir, input.operation)
    return 'stopped'
  }
  const conflictChoice = choice as ConflictChoice

  if (conflictChoice === 'manual') {
    printManualRecoveryCommands(input.dir, input.operation)
    return 'stopped'
  }

  if (conflictChoice === 'abort') {
    const aborted = input.operation === 'rebase'
      ? await abortRebase(input.dir)
      : await abortMerge(input.dir)
    return aborted ? 'stopped' : 'failed'
  }

  if (conflicts.length === 0) return 'failed'

  const side = mapConflictChoiceToGitSide(input.operation, conflictChoice)
  if (!(await checkoutConflictSide(input.dir, side, conflicts))) {
    printManualRecoveryCommands(input.dir, input.operation)
    return 'stopped'
  }
  if (!(await stagePaths(input.dir, conflicts))) {
    printManualRecoveryCommands(input.dir, input.operation)
    return 'stopped'
  }

  const completed = input.operation === 'rebase'
    ? await continueRebase(input.dir)
    : await commitNoEdit(input.dir)
  if (completed) return 'updated'

  printManualRecoveryCommands(input.dir, input.operation)
  return 'stopped'
}

function getConflictChoiceLabel(choice: ConflictChoice): string {
  if (choice === 'local') return rt('repoSyncConflictUseLocal')
  if (choice === 'incoming') return rt('repoSyncConflictUseIncoming')
  if (choice === 'manual') return rt('repoSyncConflictManual')
  return rt('repoSyncConflictAbort')
}

function getConflictChoiceHint(choice: ConflictChoice): string | undefined {
  if (choice === 'local') return rt('repoSyncConflictUseLocalHint')
  if (choice === 'incoming') return rt('repoSyncConflictUseIncomingHint')
  if (choice === 'manual') return rt('repoSyncConflictManualHint')
  if (choice === 'abort') return rt('repoSyncConflictAbortHint')
  return undefined
}
