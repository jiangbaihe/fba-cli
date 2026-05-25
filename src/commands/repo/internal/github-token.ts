import { run } from './process.js'

export type GitHubTokenSource = 'GITHUB_TOKEN' | 'GH_TOKEN' | 'gh' | 'git-credential'
const TOKEN_HELPER_TIMEOUT = 5000

export interface GitHubTokenResult {
  source: GitHubTokenSource
  token: string
}

type EnvLike = Record<string, string | undefined>

export function getEnvGitHubToken(env: EnvLike = process.env): GitHubTokenResult | null {
  const githubToken = env.GITHUB_TOKEN?.trim()
  if (githubToken) return { source: 'GITHUB_TOKEN', token: githubToken }

  const ghToken = env.GH_TOKEN?.trim()
  if (ghToken) return { source: 'GH_TOKEN', token: ghToken }

  return null
}

export async function readGhAuthToken(): Promise<GitHubTokenResult | null> {
  const result = await run('gh', ['auth', 'token'], {
    stdio: 'pipe',
    showErrorOutput: false,
    timeout: TOKEN_HELPER_TIMEOUT,
    env: { GH_PROMPT_DISABLED: '1' },
  })
  const token = result.stdout.trim()
  if (result.exitCode !== 0 || !token) return null
  return { source: 'gh', token }
}

export async function readGitCredentialToken(): Promise<GitHubTokenResult | null> {
  const result = await run('git', ['credential', 'fill'], {
    stdio: 'pipe',
    showErrorOutput: false,
    input: [
      'protocol=https',
      'host=github.com',
      'wwwauth=Basic realm="GitHub"',
      '',
      '',
    ].join('\n'),
    timeout: TOKEN_HELPER_TIMEOUT,
    env: {
      GCM_INTERACTIVE: 'never',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  if (result.exitCode !== 0) return null

  const password = parseCredentialOutput(result.stdout).password?.trim()
  if (!password) return null
  return { source: 'git-credential', token: password }
}

export async function resolveGitHubToken(
  env: EnvLike = process.env,
): Promise<GitHubTokenResult | null> {
  return getEnvGitHubToken(env)
    ?? await readGhAuthToken()
    ?? await readGitCredentialToken()
}

function parseCredentialOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    parsed[line.slice(0, index)] = line.slice(index + 1)
  }
  return parsed
}
