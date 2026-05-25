import { existsSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import {
  checkoutDetached,
  checkoutExistingBranch,
  deleteLocalBranch,
  deinitSubmodules,
  ensureRemote,
  getCurrentBranch,
  getHeadCommit,
  getRemoteUrl,
  isGitRepoRoot,
  listLocalBranches,
  removeRemote,
} from './git.js'
import { isDirectoryEmpty, readOptionalTextFile } from './files.js'
import { parseGitmodules } from './status.js'

export interface RepoInitSnapshotInput {
  projectDir: string
  backendDir: string
  frontendDir: string
}

interface RemoteSnapshot {
  origin: string | null
  upstream: string | null
}

interface SubmoduleMetadataSnapshot {
  backend: string | null
  frontend: string | null
}

interface CheckoutSnapshot {
  branch: string | null
  head: string | null
  localBranches: string[]
}

interface ChildDirectorySnapshot {
  existed: boolean
  isGitRoot: boolean
  wasEmpty: boolean
}

export interface RepoInitSnapshot {
  projectDir: string
  backendDir: string
  frontendDir: string
  mainHadGit: boolean
  mainIsGitRoot: boolean
  backendDirectory: ChildDirectorySnapshot
  frontendDirectory: ChildDirectorySnapshot
  gitmodules: string | null
  mainRemotes: RemoteSnapshot
  backendRemotes: RemoteSnapshot
  frontendRemotes: RemoteSnapshot
  mainCheckout: CheckoutSnapshot
  backendCheckout: CheckoutSnapshot
  frontendCheckout: CheckoutSnapshot
  submoduleMetadata: SubmoduleMetadataSnapshot
}

async function snapshotRemotes(dir: string): Promise<RemoteSnapshot> {
  return {
    origin: await getRemoteUrl(dir, 'origin'),
    upstream: await getRemoteUrl(dir, 'upstream'),
  }
}

async function snapshotCheckout(dir: string): Promise<CheckoutSnapshot> {
  return {
    branch: await getCurrentBranch(dir),
    head: await getHeadCommit(dir),
    localBranches: await listLocalBranches(dir),
  }
}

async function restoreRemote(dir: string, name: string, url: string | null): Promise<void> {
  const current = await getRemoteUrl(dir, name)
  if (url) {
    await ensureRemote(dir, name, url)
  } else if (current) {
    await removeRemote(dir, name)
  }
}

async function restoreCheckout(dir: string, snapshot: CheckoutSnapshot): Promise<void> {
  if (snapshot.branch) {
    await checkoutExistingBranch(dir, snapshot.branch)
    return
  }

  if (snapshot.head) {
    await checkoutDetached(dir, snapshot.head)
  }
}

export async function createRepoInitSnapshot(
  input: RepoInitSnapshotInput,
): Promise<RepoInitSnapshot> {
  const gitmodulesPath = join(input.projectDir, '.gitmodules')
  const gitmodules = readOptionalTextFile(gitmodulesPath)
  const backendName = getSubmoduleName(input.projectDir, input.backendDir, gitmodules)
  const frontendName = getSubmoduleName(input.projectDir, input.frontendDir, gitmodules)
  const backendExisted = existsSync(input.backendDir)
  const frontendExisted = existsSync(input.frontendDir)
  const [mainIsGitRoot, backendIsGitRoot, frontendIsGitRoot] = await Promise.all([
    isGitRepoRoot(input.projectDir),
    backendExisted ? isGitRepoRoot(input.backendDir) : false,
    frontendExisted ? isGitRepoRoot(input.frontendDir) : false,
  ])

  return {
    ...input,
    mainHadGit: existsSync(join(input.projectDir, '.git')),
    mainIsGitRoot,
    backendDirectory: {
      existed: backendExisted,
      isGitRoot: backendIsGitRoot,
      wasEmpty: backendExisted ? isDirectoryEmpty(input.backendDir) : false,
    },
    frontendDirectory: {
      existed: frontendExisted,
      isGitRoot: frontendIsGitRoot,
      wasEmpty: frontendExisted ? isDirectoryEmpty(input.frontendDir) : false,
    },
    gitmodules,
    mainRemotes: mainIsGitRoot ? await snapshotRemotes(input.projectDir) : emptyRemoteSnapshot(),
    backendRemotes: backendIsGitRoot ? await snapshotRemotes(input.backendDir) : emptyRemoteSnapshot(),
    frontendRemotes: frontendIsGitRoot ? await snapshotRemotes(input.frontendDir) : emptyRemoteSnapshot(),
    mainCheckout: mainIsGitRoot ? await snapshotCheckout(input.projectDir) : emptyCheckoutSnapshot(),
    backendCheckout: backendIsGitRoot ? await snapshotCheckout(input.backendDir) : emptyCheckoutSnapshot(),
    frontendCheckout: frontendIsGitRoot ? await snapshotCheckout(input.frontendDir) : emptyCheckoutSnapshot(),
    submoduleMetadata: {
      backend: backendName && existsSync(join(input.projectDir, '.git', 'modules', backendName)) ? backendName : null,
      frontend: frontendName && existsSync(join(input.projectDir, '.git', 'modules', frontendName)) ? frontendName : null,
    },
  }
}

export async function restoreRepoInitSnapshot(snapshot: RepoInitSnapshot): Promise<void> {
  const gitmodulesPath = join(snapshot.projectDir, '.gitmodules')

  if (snapshot.gitmodules === null) {
    rmSync(gitmodulesPath, { force: true })
  } else {
    writeFileSync(gitmodulesPath, snapshot.gitmodules, 'utf-8')
  }

  if (snapshot.mainIsGitRoot) {
    await restoreRemote(snapshot.projectDir, 'origin', snapshot.mainRemotes.origin)
    await restoreRemote(snapshot.projectDir, 'upstream', snapshot.mainRemotes.upstream)
  }
  if (snapshot.backendDirectory.isGitRoot) {
    await restoreRemote(snapshot.backendDir, 'origin', snapshot.backendRemotes.origin)
    await restoreRemote(snapshot.backendDir, 'upstream', snapshot.backendRemotes.upstream)
  }
  if (snapshot.frontendDirectory.isGitRoot) {
    await restoreRemote(snapshot.frontendDir, 'origin', snapshot.frontendRemotes.origin)
    await restoreRemote(snapshot.frontendDir, 'upstream', snapshot.frontendRemotes.upstream)
  }

  if (snapshot.mainIsGitRoot) {
    await restoreCheckout(snapshot.projectDir, snapshot.mainCheckout)
  }
  if (snapshot.backendDirectory.isGitRoot) {
    await restoreCheckout(snapshot.backendDir, snapshot.backendCheckout)
    await removeCreatedBranches(snapshot.backendDir, snapshot.backendCheckout.localBranches)
  }
  if (snapshot.frontendDirectory.isGitRoot) {
    await restoreCheckout(snapshot.frontendDir, snapshot.frontendCheckout)
    await removeCreatedBranches(snapshot.frontendDir, snapshot.frontendCheckout.localBranches)
  }

  if (!snapshot.mainHadGit) {
    rmSync(join(snapshot.projectDir, '.git'), { recursive: true, force: true })
  }

  if (!snapshot.backendDirectory.existed) {
    rmSync(snapshot.backendDir, { recursive: true, force: true })
  } else if (!snapshot.backendDirectory.isGitRoot && snapshot.backendDirectory.wasEmpty) {
    cleanDirectory(snapshot.backendDir)
  }
  if (!snapshot.frontendDirectory.existed) {
    rmSync(snapshot.frontendDir, { recursive: true, force: true })
  } else if (!snapshot.frontendDirectory.isGitRoot && snapshot.frontendDirectory.wasEmpty) {
    cleanDirectory(snapshot.frontendDir)
  }

  const backendName = getSubmoduleName(snapshot.projectDir, snapshot.backendDir, snapshot.gitmodules)
  const backendPathName = getSubmodulePath(snapshot.projectDir, snapshot.backendDir)
  const frontendName = getSubmoduleName(snapshot.projectDir, snapshot.frontendDir, snapshot.gitmodules)
  const frontendPathName = getSubmodulePath(snapshot.projectDir, snapshot.frontendDir)
  const createdSubmoduleMetadata = [
    backendName && snapshot.submoduleMetadata.backend !== backendName ? backendName : null,
    backendPathName !== backendName ? backendPathName : null,
    frontendName && snapshot.submoduleMetadata.frontend !== frontendName ? frontendName : null,
    frontendPathName !== frontendName ? frontendPathName : null,
  ].filter((name): name is string => Boolean(name))

  if (createdSubmoduleMetadata.length > 0) {
    const namesToDeinit = createdSubmoduleMetadata.filter((name) => (
      name === backendName || name === frontendName
    ))
    if (namesToDeinit.length > 0) {
      await deinitSubmodules(snapshot.projectDir, namesToDeinit)
    }
    for (const name of createdSubmoduleMetadata) {
      rmSync(join(snapshot.projectDir, '.git', 'modules', name), { recursive: true, force: true })
    }
  }
}

function emptyRemoteSnapshot(): RemoteSnapshot {
  return {
    origin: null,
    upstream: null,
  }
}

function emptyCheckoutSnapshot(): CheckoutSnapshot {
  return {
    branch: null,
    head: null,
    localBranches: [],
  }
}

async function removeCreatedBranches(dir: string, originalBranches: string[]): Promise<void> {
  const original = new Set(originalBranches)
  const current = await listLocalBranches(dir)
  for (const branch of current) {
    if (!original.has(branch)) await deleteLocalBranch(dir, branch)
  }
}

function cleanDirectory(dir: string): void {
  if (!existsSync(dir)) return

  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true })
  }
}

function getSubmoduleName(projectDir: string, childDir: string, gitmodules: string | null): string {
  const path = getSubmodulePath(projectDir, childDir)
  if (!path) return ''
  if (!gitmodules) return path

  const entries = parseGitmodules(gitmodules)
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.path === path) return name
  }
  return path
}

function getSubmodulePath(projectDir: string, childDir: string): string {
  if (!isAbsolute(childDir)) return childDir.replace(/\\/g, '/')

  const relativePath = relative(projectDir, childDir)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return ''
  }

  return relativePath.replace(/\\/g, '/')
}
