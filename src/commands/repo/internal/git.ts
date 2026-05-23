import { resolve } from 'path'
import { run } from './process.js'

export type EnsureRemoteResult = 'added' | 'updated' | 'unchanged'

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_EDITOR: 'true',
}

export async function cloneRepository(
  url: string,
  targetDir: string,
  options: { fullHistory?: boolean; label?: string; spinner?: boolean } = {},
): Promise<boolean> {
  const args = ['clone']
  if (!options.fullHistory) {
    args.push('--depth', '1')
  }
  args.push(url, targetDir)

  const result = await run('git', args, {
    spinner: options.spinner ?? true,
    label: options.label ?? `Cloning ${url}`,
  })
  return result.exitCode === 0
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

export async function isGitRepoRoot(dir: string): Promise<boolean> {
  const result = await run('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return false

  const topLevel = resolve(result.stdout.trim())
  const inputDir = resolve(dir)
  if (process.platform === 'win32') {
    return topLevel.toLowerCase() === inputDir.toLowerCase()
  }

  return topLevel === inputDir
}

export async function getRemoteUrl(dir: string, name: string): Promise<string | null> {
  const result = await run('git', ['remote', 'get-url', name], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  return result.stdout.trim() || null
}

export async function getPorcelainStatus(dir: string): Promise<string[] | null> {
  const result = await run('git', ['status', '--porcelain'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

export async function getCurrentBranch(dir: string): Promise<string | null> {
  const result = await run('git', ['branch', '--show-current'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  return result.stdout.trim() || null
}

export async function dryRunPushCurrentBranch(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['push', '--dry-run', 'origin', `HEAD:${branch}`], {
    cwd: dir,
    stdio: 'pipe',
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function pushCurrentBranch(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['push', '-u', 'origin', `HEAD:${branch}`], {
    cwd: dir,
    spinner: true,
    label: `Pushing ${branch}`,
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function fetchOrigin(dir: string): Promise<boolean> {
  return fetchRemote(dir, 'origin')
}

export async function fetchRemote(dir: string, remote: string): Promise<boolean> {
  const result = await run('git', ['fetch', remote, '--prune'], {
    cwd: dir,
    spinner: true,
    label: `Fetching ${remote}`,
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function getRemoteBranchRef(
  dir: string,
  branch: string,
  remote = 'origin',
): Promise<string | null> {
  const result = await run('git', ['rev-parse', '--verify', `${remote}/${branch}`], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  return result.stdout.trim() || null
}

export interface AheadBehind {
  ahead: number
  behind: number
}

export async function getAheadBehind(
  dir: string,
  localRef: string,
  remoteRef: string,
): Promise<AheadBehind | null> {
  const result = await run('git', ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/)
  const ahead = Number(aheadRaw)
  const behind = Number(behindRaw)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null

  return { ahead, behind }
}

export async function fastForwardFromOrigin(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['merge', '--ff-only', `origin/${branch}`], {
    cwd: dir,
    spinner: true,
    label: `Fast-forwarding ${branch}`,
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function mergeRef(
  dir: string,
  ref: string,
  options: { ffOnly: boolean },
): Promise<boolean> {
  const args = options.ffOnly ? ['merge', '--ff-only', ref] : ['merge', '--no-edit', ref]
  const result = await run('git', args, {
    cwd: dir,
    spinner: true,
    label: `Merging ${ref}`,
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function rebaseOnto(dir: string, ref: string): Promise<boolean> {
  const result = await run('git', ['rebase', ref], {
    cwd: dir,
    spinner: true,
    label: `Rebasing onto ${ref}`,
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function abortMerge(dir: string): Promise<boolean> {
  const result = await run('git', ['merge', '--abort'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}

export async function abortRebase(dir: string): Promise<boolean> {
  const result = await run('git', ['rebase', '--abort'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}

export async function continueRebase(dir: string): Promise<boolean> {
  const result = await run('git', ['rebase', '--continue'], {
    cwd: dir,
    spinner: true,
    label: 'Continuing rebase',
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function commitNoEdit(dir: string): Promise<boolean> {
  const result = await run('git', ['commit', '--no-edit'], {
    cwd: dir,
    spinner: true,
    label: 'Committing merge',
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function commitWithMessage(dir: string, message: string): Promise<boolean> {
  const result = await run('git', ['commit', '-m', message], {
    cwd: dir,
    spinner: true,
    label: 'Committing changes',
    timeout: 30000,
    env: NON_INTERACTIVE_GIT_ENV,
  })
  return result.exitCode === 0
}

export async function checkoutConflictSide(
  dir: string,
  side: 'ours' | 'theirs',
  paths: string[],
): Promise<boolean> {
  const result = await run('git', ['checkout', `--${side}`, '--', ...paths], {
    cwd: dir,
    stdio: 'pipe',
  })
  return result.exitCode === 0
}

export async function stagePaths(dir: string, paths: string[]): Promise<boolean> {
  const result = await run('git', ['add', '--', ...paths], {
    cwd: dir,
    stdio: 'pipe',
  })
  return result.exitCode === 0
}

export async function getConflictedPaths(dir: string): Promise<string[]> {
  const status = await getPorcelainStatus(dir)
  if (!status) return []

  return status
    .filter((line) => ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(line.slice(0, 2)))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

export async function listRemoteBranches(dir: string, remote: string): Promise<string[]> {
  const result = await run('git', ['branch', '-r', '--list', `${remote}/*`], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${remote}/`) && !line.includes(' -> '))
    .map((line) => line.slice(remote.length + 1))
    .filter(Boolean)
}

export async function ensureRemote(
  dir: string,
  name: string,
  url: string,
): Promise<EnsureRemoteResult> {
  const current = await getRemoteUrl(dir, name)
  if (!current) {
    const result = await run('git', ['remote', 'add', name, url], {
      cwd: dir,
      stdio: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(`Failed to add ${name} remote`)
    return 'added'
  }

  if (current === url) return 'unchanged'

  const result = await run('git', ['remote', 'set-url', name, url], {
    cwd: dir,
    stdio: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(`Failed to update ${name} remote`)
  return 'updated'
}

export async function removeRemote(dir: string, name: string): Promise<void> {
  const result = await run('git', ['remote', 'remove', name], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) throw new Error(`Failed to remove ${name} remote`)
}

export async function isShallowRepo(dir: string): Promise<boolean> {
  const result = await run('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

export async function unshallowRepo(dir: string): Promise<boolean> {
  const result = await run('git', ['fetch', '--unshallow', '--tags'], {
    cwd: dir,
    spinner: true,
    label: 'Fetching full git history',
  })
  return result.exitCode === 0
}

export async function initGitRepo(dir: string, branch = 'main'): Promise<boolean> {
  const result = await run('git', ['init', '-b', branch], {
    cwd: dir,
    stdio: 'pipe',
  })
  return result.exitCode === 0
}
