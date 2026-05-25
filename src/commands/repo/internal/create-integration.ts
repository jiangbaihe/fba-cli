import { cloneRepository } from './git.js'
import { rt } from './text.js'

export async function cloneRepositoryForMaintenance(
  url: string,
  targetDir: string,
  options: { label?: string; spinner?: boolean } = {},
): Promise<boolean> {
  return cloneRepository(url, targetDir, {
    ...options,
    fullHistory: true,
  })
}

export async function runRepoInitForCreate(projectDir: string): Promise<boolean> {
  const { repoInitAction } = await import('../init.js')
  return repoInitAction({ projectDir })
}

export const repoCreateText = {
  maintenanceQuestion: () => rt('repoMaintenanceQuestion'),
  initNowQuestion: () => rt('repoInitNowQuestion'),
  initFailedHint: () => rt('repoInitFailedHint'),
}
