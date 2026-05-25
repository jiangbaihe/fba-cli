import { ofetch } from 'ofetch'

export interface GitHubRepoRef {
  owner: string
  repo: string
  normalizedUrl: string
}

export interface GitHubRepository {
  full_name: string
  clone_url: string
  private?: boolean
}

export interface CreateRepositoryInput {
  owner: string
  name: string
  private: boolean
  authenticatedUser: string
}

type FetchLike = typeof ofetch
const GITHUB_API_TIMEOUT = 30000

export function parseGitHubHttpsUrl(url: string): GitHubRepoRef | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.search || parsed.hash) return null

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  const owner = safeDecodeURIComponent(parts[0])
  const repoWithSuffix = safeDecodeURIComponent(parts[1])
  if (!owner || !repoWithSuffix) return null

  const repo = repoWithSuffix.replace(/\.git$/i, '')
  if (!isValidGitHubOwner(owner) || !isValidGitHubRepoName(repo)) return null

  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}.git`,
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function isValidGitHubOwner(owner: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
}

function isValidGitHubRepoName(repo: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(repo) && repo !== '.' && repo !== '..'
}

export function createGitHubClient(token: string, fetcher: FetchLike = ofetch) {
  const request = <T>(path: string, options: Record<string, unknown> = {}) =>
    fetcher<T>(path, {
      baseURL: 'https://api.github.com',
      timeout: GITHUB_API_TIMEOUT,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...options,
    })

  return {
    async getAuthenticatedUser(): Promise<{ login: string }> {
      return request<{ login: string }>('/user', { method: 'GET' })
    },

    async getRepository(owner: string, repo: string): Promise<GitHubRepository | null> {
      try {
        return await request<GitHubRepository>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          { method: 'GET' },
        )
      } catch (error) {
        if (isHttpStatus(error, 404)) return null
        throw error
      }
    },

    async createRepository(input: CreateRepositoryInput): Promise<GitHubRepository> {
      const path =
        input.owner.toLowerCase() === input.authenticatedUser.toLowerCase()
          ? '/user/repos'
          : `/orgs/${encodeURIComponent(input.owner)}/repos`

      return request<GitHubRepository>(path, {
        method: 'POST',
        body: {
          name: input.name,
          private: input.private,
        },
      })
    },
  }
}

export type GitHubClient = ReturnType<typeof createGitHubClient>

function isHttpStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== 'object') return false

  const maybeError = error as { status?: unknown; response?: { status?: unknown } }
  return maybeError.status === status || maybeError.response?.status === status
}
