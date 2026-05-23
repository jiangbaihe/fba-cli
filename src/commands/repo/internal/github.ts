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

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  if (!repo) return null

  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}.git`,
  }
}

export function createGitHubClient(token: string, fetcher: FetchLike = ofetch) {
  const request = <T>(path: string, options: Record<string, unknown> = {}) =>
    fetcher<T>(path, {
      baseURL: 'https://api.github.com',
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
