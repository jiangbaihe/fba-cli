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

export const repoCreateText = {
  maintenanceQuestion: () => rt('repoMaintenanceQuestion'),
  initNowQuestion: () => rt('repoInitNowQuestion'),
  initFailedHint: () => rt('repoInitFailedHint'),
}
