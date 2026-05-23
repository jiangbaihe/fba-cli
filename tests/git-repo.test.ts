import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { resolve } from 'path'

const runMock = mock(async () => ({ stdout: '', stderr: '', exitCode: 0 }))

mock.module('../src/commands/repo/internal/process.ts', () => ({
  run: runMock,
}))

const {
  abortMerge,
  abortRebase,
  checkoutConflictSide,
  commitWithMessage,
  commitNoEdit,
  continueRebase,
  cloneRepository,
  dryRunPushCurrentBranch,
  ensureRemote,
  fastForwardFromOrigin,
  fetchOrigin,
  fetchRemote,
  getAheadBehind,
  getConflictedPaths,
  getCurrentBranch,
  getPorcelainStatus,
  getRemoteBranchRef,
  getRemoteUrl,
  initGitRepo,
  isGitRepo,
  isGitRepoRoot,
  isShallowRepo,
  listRemoteBranches,
  mergeRef,
  removeRemote,
  pushCurrentBranch,
  rebaseOnto,
  stagePaths,
  unshallowRepo,
} = await import('../src/commands/repo/internal/git.ts')

describe('git-repo helpers', () => {
  beforeEach(() => {
    runMock.mockClear()
  })

  test('detects git repositories', async () => {
    runMock.mockResolvedValueOnce({ stdout: 'true\n', stderr: '', exitCode: 0 })

    await expect(isGitRepo('repo')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('clones repositories with full history for repo maintenance', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(cloneRepository('https://example.test/repo.git', 'target-dir', {
      fullHistory: true,
      label: 'Full clone',
    })).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['clone', 'https://example.test/repo.git', 'target-dir'], {
      spinner: true,
      label: 'Full clone',
    })
  })

  test('returns false for non-git directories', async () => {
    runMock.mockResolvedValueOnce({ stdout: 'false\n', stderr: '', exitCode: 0 })

    await expect(isGitRepo('repo')).resolves.toBe(false)
  })

  test('detects git repository roots', async () => {
    runMock.mockResolvedValueOnce({ stdout: `${resolve('repo')}\n`, stderr: '', exitCode: 0 })

    await expect(isGitRepoRoot('repo')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('returns false when git root is a parent directory', async () => {
    runMock.mockResolvedValueOnce({ stdout: `${resolve('repo')}\n`, stderr: '', exitCode: 0 })

    await expect(isGitRepoRoot('repo/nested')).resolves.toBe(false)
  })

  test('returns false when git root detection fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'not a git repo', exitCode: 1 })

    await expect(isGitRepoRoot('repo')).resolves.toBe(false)
  })

  test('reads remote URL or returns null', async () => {
    runMock.mockResolvedValueOnce({
      stdout: 'https://github.com/acme/api.git\n',
      stderr: '',
      exitCode: 0,
    })

    await expect(getRemoteUrl('repo', 'origin')).resolves.toBe('https://github.com/acme/api.git')
    expect(runMock).toHaveBeenCalledWith('git', ['remote', 'get-url', 'origin'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('reads porcelain working tree status', async () => {
    runMock.mockResolvedValueOnce({
      stdout: ' M src/index.ts\n?? tests/repo-status.test.ts\n',
      stderr: '',
      exitCode: 0,
    })

    await expect(getPorcelainStatus('repo')).resolves.toEqual([
      ' M src/index.ts',
      '?? tests/repo-status.test.ts',
    ])
    expect(runMock).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('reads current branch or returns null for detached HEAD', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: 'main\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: not a repo', exitCode: 1 })

    await expect(getCurrentBranch('repo')).resolves.toBe('main')
    await expect(getCurrentBranch('repo')).resolves.toBeNull()
    await expect(getCurrentBranch('repo')).resolves.toBeNull()
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['branch', '--show-current'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('dry-runs current branch push without mutating remotes', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(dryRunPushCurrentBranch('repo', 'main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['push', '--dry-run', 'origin', 'HEAD:main'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        timeout: 30000,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_EDITOR: 'true',
        },
      },
    )
  })

  test('pushes current branch and sets upstream', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(pushCurrentBranch('repo', 'main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['push', '-u', 'origin', 'HEAD:main'],
      {
        cwd: 'repo',
        spinner: true,
        label: 'Pushing main',
        timeout: 30000,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_EDITOR: 'true',
        },
      },
    )
  })

  test('commits staged changes with a message without opening an editor', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(commitWithMessage('repo', 'chore: sync repository pointers')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['commit', '-m', 'chore: sync repository pointers'], {
      cwd: 'repo',
      spinner: true,
      label: 'Committing changes',
      timeout: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
  })

  test('returns false when dry-run or real push fails', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: 'rejected', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'rejected', exitCode: 1 })

    await expect(dryRunPushCurrentBranch('repo', 'main')).resolves.toBe(false)
    await expect(pushCurrentBranch('repo', 'main')).resolves.toBe(false)
  })

  test('fetches origin non-interactively for sync', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(fetchOrigin('repo')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['fetch', 'origin', '--prune'], {
      cwd: 'repo',
      spinner: true,
      label: 'Fetching origin',
      timeout: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
  })

  test('returns false when origin fetch fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'fetch failed', exitCode: 1 })

    await expect(fetchOrigin('repo')).resolves.toBe(false)
  })

  test('reads remote branch refs for sync', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'missing', exitCode: 1 })

    await expect(getRemoteBranchRef('repo', 'main')).resolves.toBe('abc123')
    await expect(getRemoteBranchRef('repo', 'missing')).resolves.toBeNull()
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['rev-parse', '--verify', 'origin/main'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('reads ahead and behind counts', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '2\t3\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'compare failed', exitCode: 1 })

    await expect(getAheadBehind('repo', 'HEAD', 'origin/main')).resolves.toEqual({
      ahead: 2,
      behind: 3,
    })
    await expect(getAheadBehind('repo', 'HEAD', 'origin/main')).resolves.toBeNull()
    expect(runMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...origin/main'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        showErrorOutput: false,
      },
    )
  })

  test('fast-forwards current branch from origin non-interactively', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(fastForwardFromOrigin('repo', 'main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['merge', '--ff-only', 'origin/main'], {
      cwd: 'repo',
      spinner: true,
      label: 'Fast-forwarding main',
      timeout: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
  })

  test('returns false when fast-forward fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'ff failed', exitCode: 1 })

    await expect(fastForwardFromOrigin('repo', 'main')).resolves.toBe(false)
  })

  test('runs generic fetch, merge, and rebase commands', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(fetchRemote('repo', 'upstream')).resolves.toBe(true)
    await expect(mergeRef('repo', 'origin/main', { ffOnly: true })).resolves.toBe(true)
    await expect(mergeRef('repo', 'origin/main', { ffOnly: false })).resolves.toBe(true)
    await expect(rebaseOnto('repo', 'upstream/main')).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['fetch', 'upstream', '--prune'], {
      cwd: 'repo',
      spinner: true,
      label: 'Fetching upstream',
      timeout: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['merge', '--ff-only', 'origin/main'], {
      cwd: 'repo',
      spinner: true,
      label: 'Merging origin/main',
      timeout: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
    expect(runMock).toHaveBeenNthCalledWith(3, 'git', ['merge', '--no-edit', 'origin/main'], expect.objectContaining({
      cwd: 'repo',
      label: 'Merging origin/main',
    }))
    expect(runMock).toHaveBeenNthCalledWith(4, 'git', ['rebase', 'upstream/main'], expect.objectContaining({
      cwd: 'repo',
      label: 'Rebasing onto upstream/main',
    }))
  })

  test('runs recovery commands for merge and rebase operations', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(abortMerge('repo')).resolves.toBe(true)
    await expect(abortRebase('repo')).resolves.toBe(true)
    await expect(continueRebase('repo')).resolves.toBe(true)
    await expect(commitNoEdit('repo')).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['merge', '--abort'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['rebase', '--abort'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(3, 'git', ['rebase', '--continue'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(4, 'git', ['commit', '--no-edit'], expect.objectContaining({ cwd: 'repo' }))
  })

  test('runs path-safe conflict resolution commands', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(checkoutConflictSide('repo', 'ours', ['a.ts', 'dir/b.ts'])).resolves.toBe(true)
    await expect(stagePaths('repo', ['a.ts'])).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['checkout', '--ours', '--', 'a.ts', 'dir/b.ts'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['add', '--', 'a.ts'], expect.objectContaining({ cwd: 'repo' }))
  })

  test('parses conflicted paths from porcelain status', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        'UU src/a.ts',
        'AA src/b.ts',
        ' M clean.ts',
        '?? new.ts',
        'DU deleted-by-us.ts',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })

    await expect(getConflictedPaths('repo')).resolves.toEqual([
      'src/a.ts',
      'src/b.ts',
      'deleted-by-us.ts',
    ])
    expect(runMock).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('lists remote branch names without symbolic refs', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        '  upstream/HEAD -> upstream/main',
        '  upstream/dev',
        '  upstream/main',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })

    await expect(listRemoteBranches('repo', 'upstream')).resolves.toEqual(['dev', 'main'])
    expect(runMock).toHaveBeenCalledWith('git', ['branch', '-r', '--list', 'upstream/*'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('returns null for missing or empty remote URLs', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: ' \n', stderr: '', exitCode: 0 })

    await expect(getRemoteUrl('repo', 'origin')).resolves.toBeNull()
    await expect(getRemoteUrl('repo', 'upstream')).resolves.toBeNull()
  })

  test('adds missing remotes', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(
      ensureRemote('repo', 'origin', 'https://github.com/acme/api.git'),
    ).resolves.toBe('added')

    expect(runMock).toHaveBeenLastCalledWith(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/acme/api.git'],
      expect.objectContaining({ cwd: 'repo' }),
    )
  })

  test('updates existing remotes with different URL', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: 'https://github.com/old/api.git\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(
      ensureRemote('repo', 'origin', 'https://github.com/acme/api.git'),
    ).resolves.toBe('updated')

    expect(runMock).toHaveBeenLastCalledWith(
      'git',
      ['remote', 'set-url', 'origin', 'https://github.com/acme/api.git'],
      expect.objectContaining({ cwd: 'repo' }),
    )
  })

  test('leaves matching remotes unchanged', async () => {
    runMock.mockResolvedValueOnce({
      stdout: 'https://github.com/acme/api.git\n',
      stderr: '',
      exitCode: 0,
    })

    await expect(
      ensureRemote('repo', 'origin', 'https://github.com/acme/api.git'),
    ).resolves.toBe('unchanged')
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  test('throws when adding or updating remotes fails', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'add failed', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: 'https://github.com/old/api.git\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'update failed', exitCode: 1 })

    await expect(
      ensureRemote('repo', 'origin', 'https://github.com/acme/api.git'),
    ).rejects.toThrow('Failed to add origin remote')
    await expect(
      ensureRemote('repo', 'origin', 'https://github.com/acme/api.git'),
    ).rejects.toThrow('Failed to update origin remote')
  })

  test('removes remotes and throws on failure', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'remove failed', exitCode: 1 })

    await expect(removeRemote('repo', 'origin')).resolves.toBeUndefined()
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['remote', 'remove', 'origin'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    await expect(removeRemote('repo', 'origin')).rejects.toThrow('Failed to remove origin remote')
  })

  test('detects shallow repositories', async () => {
    runMock.mockResolvedValueOnce({ stdout: 'true\n', stderr: '', exitCode: 0 })

    await expect(isShallowRepo('repo')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('unshallows repositories with tags', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(unshallowRepo('repo')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['fetch', '--unshallow', '--tags'], {
      cwd: 'repo',
      spinner: true,
      label: 'Fetching full git history',
    })
  })

  test('returns false when unshallowing fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'fetch failed', exitCode: 1 })

    await expect(unshallowRepo('repo')).resolves.toBe(false)
  })

  test('initializes git repositories on the requested branch', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(initGitRepo('repo', 'develop')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['init', '-b', 'develop'], {
      cwd: 'repo',
      stdio: 'pipe',
    })
  })

  test('returns false when git init fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'init failed', exitCode: 1 })

    await expect(initGitRepo('repo')).resolves.toBe(false)
  })
})
