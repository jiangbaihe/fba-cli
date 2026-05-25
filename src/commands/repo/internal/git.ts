import { realpathSync } from 'fs'
import { resolve } from 'path'
import { Buffer } from 'buffer'
import { run } from './process.js'

export type EnsureRemoteResult = 'added' | 'updated' | 'unchanged'

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_EDITOR: 'true',
}
const NETWORK_GIT_TIMEOUT = 300000

interface GitAuthOptions {
  authToken?: string
}

function getNetworkGitEnv(options: GitAuthOptions = {}): Record<string, string> {
  const token = options.authToken?.trim()
  if (!token) return NON_INTERACTIVE_GIT_ENV

  const basicToken = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    ...NON_INTERACTIVE_GIT_ENV,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicToken}`,
  }
}

export async function cloneRepository(
  url: string,
  targetDir: string,
  options: { fullHistory?: boolean; label?: string; spinner?: boolean; authToken?: string } = {},
): Promise<boolean> {
  const args = ['clone']
  if (!options.fullHistory) {
    args.push('--depth', '1')
  }
  args.push(url, targetDir)

  const result = await run('git', args, {
    spinner: options.spinner ?? true,
    label: options.label ?? `Cloning ${url}`,
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
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

  const topLevel = resolveRealPath(result.stdout.trim())
  const inputDir = resolveRealPath(dir)
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

function resolveRealPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

export async function getHeadCommit(dir: string): Promise<string | null> {
  const result = await run('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return null

  return result.stdout.trim() || null
}

export async function checkoutBranch(
  dir: string,
  branch: string,
  startPoint: string,
): Promise<boolean> {
  const result = await run('git', ['checkout', '-B', branch, startPoint], {
    cwd: dir,
    spinner: true,
    label: `Checking out ${branch}`,
    timeout: 30000,
  })
  return result.exitCode === 0
}

export async function checkoutExistingBranch(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['checkout', branch], {
    cwd: dir,
    spinner: true,
    label: `Checking out ${branch}`,
    timeout: 30000,
  })
  return result.exitCode === 0
}

export async function checkoutDetached(dir: string, commit: string): Promise<boolean> {
  const result = await run('git', ['checkout', '--detach', commit], {
    cwd: dir,
    spinner: true,
    label: 'Restoring detached HEAD',
    timeout: 30000,
  })
  return result.exitCode === 0
}

export async function checkoutNewBranchAtHead(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['checkout', '-b', branch], {
    cwd: dir,
    spinner: true,
    label: `Checking out ${branch}`,
    timeout: 30000,
  })
  return result.exitCode === 0
}

export async function deleteLocalBranch(dir: string, branch: string): Promise<boolean> {
  const result = await run('git', ['branch', '-D', branch], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}

export async function dryRunPushCurrentBranch(
  dir: string,
  branch: string,
  options: GitAuthOptions = {},
): Promise<boolean> {
  const result = await run('git', ['push', '--dry-run', '--no-follow-tags', 'origin', `HEAD:${branch}`], {
    cwd: dir,
    stdio: 'pipe',
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
  })
  return result.exitCode === 0
}

export async function pushCurrentBranch(
  dir: string,
  branch: string,
  options: GitAuthOptions = {},
): Promise<boolean> {
  const result = await run('git', ['push', '--no-follow-tags', '-u', 'origin', `HEAD:${branch}`], {
    cwd: dir,
    spinner: true,
    label: `Pushing ${branch}`,
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
  })
  return result.exitCode === 0
}

export async function fetchOrigin(dir: string, options: GitAuthOptions = {}): Promise<boolean> {
  return fetchRemote(dir, 'origin', options)
}

export async function fetchRemote(
  dir: string,
  remote: string,
  options: GitAuthOptions = {},
): Promise<boolean> {
  const result = await run('git', ['fetch', remote, '--prune'], {
    cwd: dir,
    spinner: true,
    label: `Fetching ${remote}`,
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
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

export async function hasLocalCommitsOnOrigin(dir: string, branch: string): Promise<boolean | null> {
  const commits = await run('git', ['rev-list', `origin/${branch}..HEAD`], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (commits.exitCode !== 0) return null

  const localCommits = commits.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (localCommits.length === 0) return false

  for (const commit of localCommits) {
    const contains = await run('git', ['branch', '-r', '--contains', commit, '--list', 'origin/*'], {
      cwd: dir,
      stdio: 'pipe',
      showErrorOutput: false,
    })
    if (contains.exitCode !== 0) return null

    const isContainedOnOrigin = contains.stdout
      .split(/\r?\n/)
      .some((line) => line.trim().startsWith('origin/') && !line.includes(' -> '))
    if (isContainedOnOrigin) return true
  }

  return false
}

export async function getSubmoduleCommitsInMainRange(
  projectDir: string,
  branch: string,
  paths: string[],
): Promise<Record<string, string[]> | null> {
  const originBranch = `origin/${branch}`
  const remoteBranch = await run('git', ['rev-parse', '--verify', originBranch], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  const range = remoteBranch.exitCode === 0 ? `${originBranch}..HEAD` : 'HEAD'
  const commitsResult = await run('git', ['rev-list', range], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (commitsResult.exitCode !== 0) return null

  const result: Record<string, string[]> = Object.fromEntries(paths.map((path) => [path, []]))
  const seen = new Map(paths.map((path) => [path, new Set<string>()]))
  const commits = commitsResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const commit of commits) {
    const tree = await run('git', ['ls-tree', commit, '--', ...paths], {
      cwd: projectDir,
      stdio: 'pipe',
      showErrorOutput: false,
    })
    if (tree.exitCode !== 0) return null

    for (const line of tree.stdout.split(/\r?\n/)) {
      const match = line.match(/\bcommit\s+([0-9a-f]{40})\t(.+)$/i)
      if (!match) continue

      const hash = match[1]!
      const path = match[2]!
      const pathSeen = seen.get(path)
      if (!pathSeen || pathSeen.has(hash)) continue

      pathSeen.add(hash)
      result[path]!.push(hash)
    }
  }

  return result
}

export async function getMissingSubmoduleGitlinkPaths(
  projectDir: string,
  paths: string[],
): Promise<string[] | null> {
  if (paths.length === 0) return []

  const pointer = await run('git', ['ls-tree', 'HEAD', '--', ...paths], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (pointer.exitCode !== 0) return null

  const gitlinkPaths = new Set<string>()
  for (const line of pointer.stdout.split(/\r?\n/)) {
    const match = line.match(/^160000\s+commit\s+[0-9a-f]{40}\t(.+)$/i)
    if (match) gitlinkPaths.add(match[1]!)
  }

  return paths.filter((path) => !gitlinkPaths.has(path))
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

export async function unstagePaths(dir: string, paths: string[]): Promise<boolean> {
  const result = await run('git', ['reset', '--', ...paths], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}

export async function getConflictedPaths(dir: string): Promise<string[]> {
  const result = await run('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return []

  return result.stdout
    .split('\0')
    .filter((path) => path.length > 0)
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

export async function listLocalBranches(dir: string): Promise<string[]> {
  const result = await run('git', ['branch', '--list'], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (result.exitCode !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*\s*/, '').trim())
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

export async function unshallowRepo(
  dir: string,
  options: GitAuthOptions = {},
): Promise<boolean> {
  const result = await run('git', ['fetch', '--unshallow', '--tags'], {
    cwd: dir,
    spinner: true,
    label: 'Fetching full git history',
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
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

export async function hasSubmodulePointerChange(dir: string, path: string): Promise<boolean | null> {
  const worktreeResult = await run('git', ['diff', '--quiet', '--ignore-submodules=dirty', '--', path], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })

  if (worktreeResult.exitCode === 1) return true
  if (worktreeResult.exitCode !== 0) return null

  const stagedResult = await run('git', ['diff', '--cached', '--quiet', '--ignore-submodules=dirty', '--', path], {
    cwd: dir,
    stdio: 'pipe',
    showErrorOutput: false,
  })

  if (stagedResult.exitCode === 0) return false
  if (stagedResult.exitCode === 1) return true
  return null
}

async function getSubmoduleCommit(projectDir: string, path: string): Promise<string | null> {
  const pointer = await run('git', ['ls-tree', 'HEAD', '--', path], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (pointer.exitCode !== 0) return null

  const match = pointer.stdout.trim().match(/\bcommit\s+([0-9a-f]{40})\b/i)
  return match?.[1] ?? null
}

export async function isCommitPushed(
  projectDir: string,
  path: string,
  commit: string,
): Promise<boolean | null> {
  const childDir = resolve(projectDir, path)
  const contains = await run('git', ['branch', '-r', '--contains', commit, '--list', 'origin/*'], {
    cwd: childDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  if (contains.exitCode !== 0) return null

  return contains.stdout
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith('origin/') && !line.includes(' -> '))
}

export async function isSubmoduleCommitPushed(projectDir: string, path: string): Promise<boolean | null> {
  const commit = await getSubmoduleCommit(projectDir, path)
  if (!commit) return null

  return isCommitPushed(projectDir, path, commit)
}

export async function isCommitOnHead(
  projectDir: string,
  path: string,
  commit: string,
): Promise<boolean | null> {
  const childDir = resolve(projectDir, path)
  const contains = await run('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: childDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })

  if (contains.exitCode === 0) return true
  if (contains.exitCode === 1) return false
  return null
}

export async function isSubmoduleCommitOnHead(projectDir: string, path: string): Promise<boolean | null> {
  const commit = await getSubmoduleCommit(projectDir, path)
  if (!commit) return null

  return isCommitOnHead(projectDir, path, commit)
}

export async function initSubmodules(
  projectDir: string,
  paths: string[],
  options: GitAuthOptions = {},
): Promise<boolean> {
  if (paths.length === 0) return true

  const syncResult = await run('git', ['submodule', 'sync', '--', ...paths], {
    cwd: projectDir,
    stdio: 'pipe',
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
  })
  if (syncResult.exitCode !== 0) return false

  const result = await run('git', ['submodule', 'update', '--init', '--checkout', '--', ...paths], {
    cwd: projectDir,
    spinner: true,
    label: 'Initializing child repositories',
    timeout: NETWORK_GIT_TIMEOUT,
    env: getNetworkGitEnv(options),
  })
  return result.exitCode === 0
}

export async function deinitSubmodules(projectDir: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true

  const result = await run('git', ['submodule', 'deinit', '-f', '--', ...paths], {
    cwd: projectDir,
    stdio: 'pipe',
    showErrorOutput: false,
  })
  return result.exitCode === 0
}
