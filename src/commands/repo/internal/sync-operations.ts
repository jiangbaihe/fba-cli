import * as clack from '@clack/prompts'
import { rt } from './text.js'
import {
  commitWithMessage,
  getPorcelainStatus,
  hasSubmodulePointerChange,
  mergeRef,
  rebaseOnto,
  stagePaths,
  unstagePaths,
} from './git.js'
import {
  handleConflict,
  type ConflictOperation,
} from './sync-conflicts.js'
import {
  buildMainRepositoryChangePlan,
  type OriginSyncAction,
  type UpstreamSyncAction,
} from './sync.js'

export type SyncAction = OriginSyncAction | UpstreamSyncAction
export type SyncCommandResult = 'updated' | 'skipped' | 'failed' | 'stopped' | 'cancelled'

export async function applySyncOperation(input: {
  dir: string
  label: string
  action: SyncAction
  targetRef: string | null
  isCancelled: (value: unknown) => boolean
}): Promise<SyncCommandResult> {
  if (!input.targetRef) return 'skipped'
  if (input.action === 'skip' || input.action === 'push-or-skip' || input.action === 'choose-upstream-branch') {
    return 'skipped'
  }

  let ok = false
  let operation: ConflictOperation | null = null

  if (input.action === 'fast-forward-origin' || input.action === 'fast-forward-upstream') {
    ok = await mergeRef(input.dir, input.targetRef, { ffOnly: true })
  } else if (input.action === 'merge-origin' || input.action === 'merge-upstream') {
    operation = 'merge'
    ok = await mergeRef(input.dir, input.targetRef, { ffOnly: false })
  } else if (input.action === 'rebase-origin' || input.action === 'rebase-upstream') {
    operation = 'rebase'
    ok = await rebaseOnto(input.dir, input.targetRef)
  }

  if (ok) return 'updated'
  if (!operation) return 'failed'

  return handleConflict({
    dir: input.dir,
    label: input.label,
    operation,
    isCancelled: input.isCancelled,
  })
}

export async function handleMainRepositoryPointerChanges(input: {
  backendName: string
  frontendName: string
  projectDir: string
  isCancelled: (value: unknown) => boolean
}): Promise<SyncCommandResult> {
  const porcelainStatus = await getPorcelainStatus(input.projectDir)
  if (porcelainStatus === null || porcelainStatus.length === 0) return 'skipped'

  const changePlan = await buildMainRepositoryChangePlan({
    porcelainStatus,
    allowedPaths: [input.backendName, input.frontendName],
    hasPointerChange: async (path) => hasSubmodulePointerChange(input.projectDir, path),
  })
  if (changePlan.committablePaths.length === 0 && changePlan.unrelatedLines.length === 0) return 'skipped'

  if (changePlan.unrelatedLines.length > 0) {
    clack.note(changePlan.unrelatedLines.join('\n'), rt('repoSyncMainUnrelatedChanges'))
    return 'stopped'
  }

  clack.note(
    changePlan.committablePaths.join('\n'),
    rt('repoSyncMainPointerChanges'),
  )
  const confirmed = await clack.confirm({
    message: rt('repoSyncMainPointerCommitQuestion'),
    initialValue: true,
  })
  if (input.isCancelled(confirmed)) return 'cancelled'
  if (!confirmed) return 'stopped'

  if (!(await stagePaths(input.projectDir, changePlan.committablePaths))) return 'failed'
  if (await commitWithMessage(input.projectDir, 'chore: sync repository pointers')) return 'updated'

  await unstagePaths(input.projectDir, changePlan.committablePaths)
  return 'failed'
}
