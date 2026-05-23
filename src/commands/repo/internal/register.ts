import type { Command } from 'commander'
import { rt } from './text.js'

export function registerRepoCommand(program: Command): void {
  const repoCmd = program
    .command('repo')
    .description(rt('cmdRepo'))

  repoCmd
    .command('init')
    .description(rt('cmdRepoInit'))
    .action(async () => {
      const { repoInitAction } = await import('../init.js')
      await repoInitAction({ project: program.opts().project })
    })

  repoCmd
    .command('status')
    .description(rt('cmdRepoStatus'))
    .action(async () => {
      const { repoStatusAction } = await import('../status.js')
      await repoStatusAction({ project: program.opts().project })
    })

  repoCmd
    .command('push')
    .description(rt('cmdRepoPush'))
    .action(async () => {
      const { repoPushAction } = await import('../push.js')
      await repoPushAction({ project: program.opts().project })
    })

  repoCmd
    .command('sync')
    .description(rt('cmdRepoSync'))
    .action(async () => {
      const { repoSyncAction } = await import('../sync.js')
      await repoSyncAction({ project: program.opts().project })
    })
}
