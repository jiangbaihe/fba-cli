import { beforeEach, describe, expect, mock, test } from 'bun:test'

const runMock = mock(async () => ({ stdout: '', stderr: '', exitCode: 1 }))

mock.module('../src/commands/repo/internal/process.ts', () => ({
  run: runMock,
}))

const {
  getEnvGitHubToken,
  readGhAuthToken,
  readGitCredentialToken,
  resolveGitHubToken,
} = await import('../src/commands/repo/internal/github-token.ts')

describe('GitHub token discovery', () => {
  beforeEach(() => {
    runMock.mockClear()
  })

  test('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    expect(getEnvGitHubToken({
      GITHUB_TOKEN: ' github-token ',
      GH_TOKEN: 'gh-token',
    })).toEqual({
      source: 'GITHUB_TOKEN',
      token: 'github-token',
    })
  })

  test('uses GH_TOKEN when GITHUB_TOKEN is missing', () => {
    expect(getEnvGitHubToken({ GH_TOKEN: ' gh-token ' })).toEqual({
      source: 'GH_TOKEN',
      token: 'gh-token',
    })
  })

  test('reads token from GitHub CLI when available', async () => {
    runMock.mockResolvedValueOnce({ stdout: ' gh-token\n', stderr: '', exitCode: 0 })

    await expect(readGhAuthToken()).resolves.toEqual({
      source: 'gh',
      token: 'gh-token',
    })
    expect(runMock).toHaveBeenCalledWith('gh', ['auth', 'token'], {
      stdio: 'pipe',
      showErrorOutput: false,
      env: { GH_PROMPT_DISABLED: '1' },
    })
  })

  test('reads token from git credential helpers without interactive prompts', async () => {
    runMock.mockResolvedValueOnce({
      stdout: [
        'protocol=https',
        'host=github.com',
        'username=jiangbaihe',
        'password=credential-token',
        '',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })

    await expect(readGitCredentialToken()).resolves.toEqual({
      source: 'git-credential',
      token: 'credential-token',
    })
    expect(runMock).toHaveBeenCalledWith('git', ['credential', 'fill'], {
      stdio: 'pipe',
      showErrorOutput: false,
      input: 'protocol=https\nhost=github.com\nwwwauth=Basic realm="GitHub"\n\n',
      timeout: 5000,
      env: {
        GCM_INTERACTIVE: 'never',
        GIT_TERMINAL_PROMPT: '0',
      },
    })
  })

  test('resolves sources in priority order', async () => {
    await expect(resolveGitHubToken({ GITHUB_TOKEN: 'env-token' })).resolves.toEqual({
      source: 'GITHUB_TOKEN',
      token: 'env-token',
    })
    expect(runMock).not.toHaveBeenCalled()

    runMock.mockResolvedValueOnce({ stdout: 'cli-token\n', stderr: '', exitCode: 0 })
    await expect(resolveGitHubToken({})).resolves.toEqual({
      source: 'gh',
      token: 'cli-token',
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
