import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ensureRemote, getRemoteUrl, removeRemote } from './git.js'

export interface RepoInitSnapshotInput {
  projectDir: string
  backendDir: string
  frontendDir: string
}

interface RemoteSnapshot {
  origin: string | null
  upstream: string | null
}

export interface RepoInitSnapshot {
  projectDir: string
  backendDir: string
  frontendDir: string
  mainHadGit: boolean
  gitmodules: string | null
  mainRemotes: RemoteSnapshot
  backendRemotes: RemoteSnapshot
  frontendRemotes: RemoteSnapshot
}

async function snapshotRemotes(dir: string): Promise<RemoteSnapshot> {
  return {
    origin: await getRemoteUrl(dir, 'origin'),
    upstream: await getRemoteUrl(dir, 'upstream'),
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

export async function createRepoInitSnapshot(
  input: RepoInitSnapshotInput,
): Promise<RepoInitSnapshot> {
  const gitmodulesPath = join(input.projectDir, '.gitmodules')

  return {
    ...input,
    mainHadGit: existsSync(join(input.projectDir, '.git')),
    gitmodules: existsSync(gitmodulesPath) ? readFileSync(gitmodulesPath, 'utf-8') : null,
    mainRemotes: await snapshotRemotes(input.projectDir),
    backendRemotes: await snapshotRemotes(input.backendDir),
    frontendRemotes: await snapshotRemotes(input.frontendDir),
  }
}

export async function restoreRepoInitSnapshot(snapshot: RepoInitSnapshot): Promise<void> {
  const gitmodulesPath = join(snapshot.projectDir, '.gitmodules')

  if (snapshot.gitmodules === null) {
    rmSync(gitmodulesPath, { force: true })
  } else {
    writeFileSync(gitmodulesPath, snapshot.gitmodules, 'utf-8')
  }

  await restoreRemote(snapshot.projectDir, 'origin', snapshot.mainRemotes.origin)
  await restoreRemote(snapshot.projectDir, 'upstream', snapshot.mainRemotes.upstream)
  await restoreRemote(snapshot.backendDir, 'origin', snapshot.backendRemotes.origin)
  await restoreRemote(snapshot.backendDir, 'upstream', snapshot.backendRemotes.upstream)
  await restoreRemote(snapshot.frontendDir, 'origin', snapshot.frontendRemotes.origin)
  await restoreRemote(snapshot.frontendDir, 'upstream', snapshot.frontendRemotes.upstream)

  if (!snapshot.mainHadGit) {
    rmSync(join(snapshot.projectDir, '.git'), { recursive: true, force: true })
  }
}
