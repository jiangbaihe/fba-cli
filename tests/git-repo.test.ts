import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

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
  getMissingSubmoduleGitlinkPaths,
  getSubmoduleCommitsInMainRange,
  getHeadCommit,
  checkoutBranch,
  checkoutDetached,
  checkoutExistingBranch,
  checkoutNewBranchAtHead,
  deleteLocalBranch,
  getPorcelainStatus,
  hasLocalCommitsOnOrigin,
  hasSubmodulePointerChange,
  isCommitOnHead,
  isCommitPushed,
  isSubmoduleCommitOnHead,
  isSubmoduleCommitPushed,
  getRemoteBranchRef,
  getRemoteUrl,
  deinitSubmodules,
  initGitRepo,
  initSubmodules,
  isGitRepo,
  isGitRepoRoot,
  isShallowRepo,
  listLocalBranches,
  listRemoteBranches,
  mergeRef,
  removeRemote,
  pushCurrentBranch,
  rebaseOnto,
  stagePaths,
  unstagePaths,
  unshallowRepo,
} = await import('../src/commands/repo/internal/git.ts')

describe('git-repo helpers', () => {
  const dirs: string[] = []

  beforeEach(() => {
    runMock.mockReset()
    runMock.mockImplementation(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
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
      timeout: 300000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
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

  test('detects git repository roots accessed through real filesystem aliases', async () => {
    const root = join(tmpdir(), `fba-repo-root-alias-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const target = join(root, 'target')
    const link = join(root, 'link')
    mkdirSync(target, { recursive: true })
    dirs.push(root)
    if (process.platform === 'win32') {
      await import('fs').then(({ symlinkSync }) => symlinkSync(target, link, 'junction'))
    } else {
      await import('fs').then(({ symlinkSync }) => symlinkSync(target, link, 'dir'))
    }
    runMock.mockResolvedValueOnce({ stdout: `${target}\n`, stderr: '', exitCode: 0 })

    await expect(isGitRepoRoot(link)).resolves.toBe(true)
  })

  test('reads the current HEAD commit for rollback snapshots', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '0123456789abcdef0123456789abcdef01234567\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: bad revision', exitCode: 128 })

    await expect(getHeadCommit('repo')).resolves.toBe('0123456789abcdef0123456789abcdef01234567')
    await expect(getHeadCommit('repo')).resolves.toBeNull()
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('checks out a local branch from origin when repairing detached child repos', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(checkoutBranch('repo', 'main', 'origin/main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['checkout', '-B', 'main', 'origin/main'], {
      cwd: 'repo',
      spinner: true,
      label: 'Checking out main',
      timeout: 30000,
    })
  })

  test('checks out existing branches and detached commits for init rollback', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(checkoutExistingBranch('repo', 'main')).resolves.toBe(true)
    await expect(checkoutDetached('repo', '0123456789abcdef0123456789abcdef01234567')).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['checkout', 'main'], {
      cwd: 'repo',
      spinner: true,
      label: 'Checking out main',
      timeout: 30000,
    })
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', [
      'checkout',
      '--detach',
      '0123456789abcdef0123456789abcdef01234567',
    ], {
      cwd: 'repo',
      spinner: true,
      label: 'Restoring detached HEAD',
      timeout: 30000,
    })
  })

  test('creates a local branch at the current child HEAD without moving commits', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(checkoutNewBranchAtHead('repo', 'main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['checkout', '-b', 'main'], {
      cwd: 'repo',
      spinner: true,
      label: 'Checking out main',
      timeout: 30000,
    })
  })

  test('deletes local branches created during init rollback', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(deleteLocalBranch('repo', 'fba-repo-main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['branch', '-D', 'fba-repo-main'], {
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
      ['push', '--dry-run', '--no-follow-tags', 'origin', 'HEAD:main'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        timeout: 300000,
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
      ['push', '--no-follow-tags', '-u', 'origin', 'HEAD:main'],
      {
        cwd: 'repo',
        spinner: true,
        label: 'Pushing main',
        timeout: 300000,
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
      timeout: 300000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
    })
  })

  test('passes GitHub tokens to network git operations through temporary config', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(fetchRemote('repo', 'origin', { authToken: 'github-token' })).resolves.toBe(true)
    await expect(dryRunPushCurrentBranch('repo', 'main', { authToken: 'github-token' })).resolves.toBe(true)
    await expect(pushCurrentBranch('repo', 'main', { authToken: 'github-token' })).resolves.toBe(true)

    for (const call of runMock.mock.calls) {
      const args = call[1]
      expect(args).not.toContain('github-token')
      expect(call[2].env).toMatchObject({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      })
      expect(call[2].env.GIT_CONFIG_VALUE_0).toStartWith('AUTHORIZATION: basic ')
      expect(call[2].env.GIT_CONFIG_VALUE_0).not.toContain('github-token')
    }
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

  test('detects local commits that already exist on origin branches', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '1111111111111111111111111111111111111111\n2222222222222222222222222222222222222222\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '  origin/feature\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '  origin/feature\n', stderr: '', exitCode: 0 })

    await expect(hasLocalCommitsOnOrigin('repo', 'main')).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', ['rev-list', 'origin/main..HEAD'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['branch', '-r', '--contains', '1111111111111111111111111111111111111111', '--list', 'origin/*'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        showErrorOutput: false,
      },
    )
  })

  test('reads submodule commits from every main commit that will be pushed', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: 'origin-main\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: [
          'commit-two',
          'commit-one',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: [
          '160000 commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tbackend',
          '160000 commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tfrontend',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: [
          '160000 commit cccccccccccccccccccccccccccccccccccccccc\tbackend',
          '160000 commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tfrontend',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      })

    await expect(getSubmoduleCommitsInMainRange(
      'repo',
      'main',
      ['backend', 'frontend'],
    )).resolves.toEqual({
      backend: [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'cccccccccccccccccccccccccccccccccccccccc',
      ],
      frontend: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    })
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['rev-parse', '--verify', 'origin/main'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['rev-list', 'origin/main..HEAD'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    expect(runMock).toHaveBeenNthCalledWith(3, 'git', [
      'ls-tree',
      'commit-two',
      '--',
      'backend',
      'frontend',
    ], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('reads submodule commits from HEAD when the main origin branch is missing', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: Needed a single revision', exitCode: 128 })
      .mockResolvedValueOnce({
        stdout: [
          'commit-one',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: [
          '160000 commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tbackend',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      })

    await expect(getSubmoduleCommitsInMainRange(
      'repo',
      'main',
      ['backend'],
    )).resolves.toEqual({
      backend: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    })
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['rev-parse', '--verify', 'origin/main'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['rev-list', 'HEAD'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('reports paths without HEAD submodule gitlinks', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        '160000 commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tbackend',
        '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tfrontend',
        '',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })

    await expect(getMissingSubmoduleGitlinkPaths('repo', ['backend', 'frontend']))
      .resolves.toEqual(['frontend'])
    expect(runMock).toHaveBeenCalledWith('git', ['ls-tree', 'HEAD', '--', 'backend', 'frontend'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('returns null when HEAD submodule gitlinks cannot be read', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'fatal: bad revision', exitCode: 128 })

    await expect(getMissingSubmoduleGitlinkPaths('repo', ['backend'])).resolves.toBeNull()
  })

  test('returns null when submodule commits in the main push range cannot be read', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: 'origin-main\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'bad revision', exitCode: 128 })

    await expect(getSubmoduleCommitsInMainRange('repo', 'main', ['backend'])).resolves.toBeNull()
  })

  test('treats partially published local commits as rebase-unsafe', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '1111111111111111111111111111111111111111\n2222222222222222222222222222222222222222\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '  origin/feature\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(hasLocalCommitsOnOrigin('repo', 'main')).resolves.toBe(true)
  })

  test('returns false when local commits are not found on origin branches', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '1111111111111111111111111111111111111111\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(hasLocalCommitsOnOrigin('repo', 'main')).resolves.toBe(false)
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
      timeout: 300000,
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
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(checkoutConflictSide('repo', 'ours', ['a.ts', 'dir/b.ts'])).resolves.toBe(true)
    await expect(stagePaths('repo', ['a.ts'])).resolves.toBe(true)
    await expect(unstagePaths('repo', ['a.ts'])).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['checkout', '--ours', '--', 'a.ts', 'dir/b.ts'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(2, 'git', ['add', '--', 'a.ts'], expect.objectContaining({ cwd: 'repo' }))
    expect(runMock).toHaveBeenNthCalledWith(3, 'git', ['reset', '--', 'a.ts'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('parses conflicted paths with git z output', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        'src/a b.ts',
        'src/"quoted".ts',
        ' leading-and-trailing-space.ts ',
        'deleted-by-us.ts',
        '',
      ].join('\0'),
      stderr: '',
      exitCode: 0,
    })

    await expect(getConflictedPaths('repo')).resolves.toEqual([
      'src/a b.ts',
      'src/"quoted".ts',
      ' leading-and-trailing-space.ts ',
      'deleted-by-us.ts',
    ])
    expect(runMock).toHaveBeenCalledWith('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
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

  test('lists local branch names', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        '* main',
        '  feature/repo-work',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })

    await expect(listLocalBranches('repo')).resolves.toEqual(['main', 'feature/repo-work'])
    expect(runMock).toHaveBeenCalledWith('git', ['branch', '--list'], {
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
      timeout: 300000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_EDITOR: 'true',
      },
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

  test('distinguishes real submodule pointer changes from dirty submodule worktrees', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: bad pathspec', exitCode: 128 })

    await expect(hasSubmodulePointerChange('repo', 'backend')).resolves.toBe(true)
    await expect(hasSubmodulePointerChange('repo', 'backend')).resolves.toBe(false)
    await expect(hasSubmodulePointerChange('repo', 'backend')).resolves.toBeNull()

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['diff', '--quiet', '--ignore-submodules=dirty', '--', 'backend'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        showErrorOutput: false,
      },
    )
  })

  test('detects staged-only submodule pointer changes', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })

    await expect(hasSubmodulePointerChange('repo', 'backend')).resolves.toBe(true)
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--cached', '--quiet', '--ignore-submodules=dirty', '--', 'backend'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        showErrorOutput: false,
      },
    )
  })

  test('checks whether the main gitlink commit exists on the child origin', async () => {
    runMock
      .mockResolvedValueOnce({
        stdout: '160000 commit 0123456789abcdef0123456789abcdef01234567\tbackend\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: '  origin/main\n',
        stderr: '',
        exitCode: 0,
      })

    await expect(isSubmoduleCommitPushed('repo', 'backend')).resolves.toBe(true)
    expect(runMock).toHaveBeenNthCalledWith(1, 'git', ['ls-tree', 'HEAD', '--', 'backend'], {
      cwd: 'repo',
      stdio: 'pipe',
      showErrorOutput: false,
    })
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['branch', '-r', '--contains', '0123456789abcdef0123456789abcdef01234567', '--list', 'origin/*'],
      expect.objectContaining({ cwd: resolve('repo', 'backend') }),
    )
  })

  test('returns false when the main gitlink commit is not on the child origin', async () => {
    runMock
      .mockResolvedValueOnce({
        stdout: '160000 commit 0123456789abcdef0123456789abcdef01234567\tbackend\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(isSubmoduleCommitPushed('repo', 'backend')).resolves.toBe(false)
  })

  test('checks arbitrary commits against child origin branches', async () => {
    runMock.mockResolvedValueOnce({
      stdout: '  origin/main\n',
      stderr: '',
      exitCode: 0,
    })

    await expect(isCommitPushed('repo', 'backend', '0123456789abcdef0123456789abcdef01234567'))
      .resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['branch', '-r', '--contains', '0123456789abcdef0123456789abcdef01234567', '--list', 'origin/*'],
      expect.objectContaining({ cwd: resolve('repo', 'backend') }),
    )
  })

  test('checks whether the main gitlink commit is included in the child HEAD', async () => {
    runMock
      .mockResolvedValueOnce({
        stdout: '160000 commit 0123456789abcdef0123456789abcdef01234567\tbackend\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: '160000 commit 89abcdef0123456789abcdef0123456789abcdef\tbackend\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 })

    await expect(isSubmoduleCommitOnHead('repo', 'backend')).resolves.toBe(true)
    await expect(isSubmoduleCommitOnHead('repo', 'backend')).resolves.toBe(false)

    expect(runMock).toHaveBeenNthCalledWith(2, 'git', [
      'merge-base',
      '--is-ancestor',
      '0123456789abcdef0123456789abcdef01234567',
      'HEAD',
    ], {
      cwd: resolve('repo', 'backend'),
      stdio: 'pipe',
      showErrorOutput: false,
    })
  })

  test('returns null when the main gitlink commit cannot be checked against child HEAD', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: '160000 commit 0123456789abcdef0123456789abcdef01234567\tbackend\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: not a repo', exitCode: 128 })

    await expect(isSubmoduleCommitOnHead('repo', 'backend')).resolves.toBeNull()
    await expect(isSubmoduleCommitOnHead('repo', 'backend')).resolves.toBeNull()
  })

  test('checks arbitrary commits against child HEAD', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(isCommitOnHead('repo', 'backend', '0123456789abcdef0123456789abcdef01234567'))
      .resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith('git', [
      'merge-base',
      '--is-ancestor',
      '0123456789abcdef0123456789abcdef01234567',
      'HEAD',
    ], expect.objectContaining({ cwd: resolve('repo', 'backend') }))
  })

  test('syncs configured submodule URLs before initializing requested submodules', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(initSubmodules('repo', ['backend', 'frontend'])).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['submodule', 'sync', '--', 'backend', 'frontend'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        timeout: 300000,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_EDITOR: 'true',
        },
      },
    )
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['submodule', 'update', '--init', '--checkout', '--', 'backend', 'frontend'],
      {
        cwd: 'repo',
        spinner: true,
        label: 'Initializing child repositories',
        timeout: 300000,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_EDITOR: 'true',
        },
      },
    )
  })

  test('deinitializes requested submodules during init rollback cleanup', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    await expect(deinitSubmodules('repo', ['backend', 'frontend'])).resolves.toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['submodule', 'deinit', '-f', '--', 'backend', 'frontend'],
      {
        cwd: 'repo',
        stdio: 'pipe',
        showErrorOutput: false,
      },
    )
  })

  test('returns false when git init fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'init failed', exitCode: 1 })

    await expect(initGitRepo('repo')).resolves.toBe(false)
  })
})
