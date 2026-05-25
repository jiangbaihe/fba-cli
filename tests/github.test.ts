import { describe, expect, mock, test } from 'bun:test'
import {
  createGitHubClient,
  parseGitHubHttpsUrl,
} from '../src/commands/repo/internal/github.ts'

describe('parseGitHubHttpsUrl', () => {
  test('parses GitHub HTTPS URLs ending in .git', () => {
    expect(parseGitHubHttpsUrl('https://github.com/acme/api.git')).toEqual({
      owner: 'acme',
      repo: 'api',
      normalizedUrl: 'https://github.com/acme/api.git',
    })
  })

  test('normalizes GitHub HTTPS URLs without .git', () => {
    expect(parseGitHubHttpsUrl('https://github.com/acme/web')).toEqual({
      owner: 'acme',
      repo: 'web',
      normalizedUrl: 'https://github.com/acme/web.git',
    })
  })

  test('rejects SSH URLs for the first version', () => {
    expect(parseGitHubHttpsUrl('git@github.com:acme/api.git')).toBeNull()
  })

  test('rejects non-GitHub HTTPS URLs', () => {
    expect(parseGitHubHttpsUrl('https://example.com/acme/api.git')).toBeNull()
  })

  test('rejects non-HTTPS GitHub URLs', () => {
    expect(parseGitHubHttpsUrl('http://github.com/acme/api.git')).toBeNull()
  })

  test('rejects GitHub URLs with query strings or fragments', () => {
    expect(parseGitHubHttpsUrl('https://github.com/acme/api.git?tab=readme')).toBeNull()
    expect(parseGitHubHttpsUrl('https://github.com/acme/api.git#readme')).toBeNull()
  })

  test('rejects GitHub URLs with embedded credentials', () => {
    expect(parseGitHubHttpsUrl('https://ghp_secret@github.com/acme/api.git')).toBeNull()
    expect(parseGitHubHttpsUrl('https://octo:ghp_secret@github.com/acme/api.git')).toBeNull()
  })

  test('rejects GitHub URLs with invalid owner or repository segments', () => {
    expect(parseGitHubHttpsUrl('https://github.com/-acme/api.git')).toBeNull()
    expect(parseGitHubHttpsUrl('https://github.com/acme-/api.git')).toBeNull()
    expect(parseGitHubHttpsUrl('https://github.com/acme/my%20api.git')).toBeNull()
  })

  test('returns null for malformed percent-encoded GitHub paths', () => {
    expect(parseGitHubHttpsUrl('https://github.com/acme/%ZZ.git')).toBeNull()
    expect(parseGitHubHttpsUrl('https://github.com/%ZZ/api.git')).toBeNull()
  })
})

describe('createGitHubClient', () => {
  test('gets the authenticated user', async () => {
    const fetchMock = mock(async () => ({ login: 'octo' }))
    const client = createGitHubClient('token', fetchMock)

    await expect(client.getAuthenticatedUser()).resolves.toEqual({ login: 'octo' })
    expect(fetchMock).toHaveBeenCalledWith('/user', expect.objectContaining({
      method: 'GET',
    }))
  })

  test('uses GitHub API base URL and headers', async () => {
    const fetchMock = mock(async () => ({ login: 'octo' }))
    const client = createGitHubClient('token', fetchMock)

    await client.getAuthenticatedUser()

    expect(fetchMock).toHaveBeenCalledWith('/user', expect.objectContaining({
      baseURL: 'https://api.github.com',
      timeout: 30000,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer token',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }))
  })

  test('returns null for missing repositories', async () => {
    const fetchMock = mock(async () => {
      const error = new Error('not found') as Error & { status?: number }
      error.status = 404
      throw error
    })
    const client = createGitHubClient('token', fetchMock)

    await expect(client.getRepository('acme', 'api')).resolves.toBeNull()
  })

  test('rethrows non-404 repository errors', async () => {
    const error = new Error('server error') as Error & { status?: number }
    error.status = 500
    const fetchMock = mock(async () => {
      throw error
    })
    const client = createGitHubClient('token', fetchMock)

    await expect(client.getRepository('acme', 'api')).rejects.toBe(error)
  })

  test('creates user repositories', async () => {
    const fetchMock = mock(async () => ({
      full_name: 'octo/api',
      clone_url: 'https://github.com/octo/api.git',
    }))
    const client = createGitHubClient('token', fetchMock)

    await client.createRepository({
      owner: 'octo',
      name: 'api',
      private: false,
      authenticatedUser: 'octo',
    })

    expect(fetchMock).toHaveBeenCalledWith('/user/repos', expect.objectContaining({
      method: 'POST',
      body: {
        name: 'api',
        private: false,
      },
    }))
  })

  test('treats authenticated user owner comparison as case-insensitive', async () => {
    const fetchMock = mock(async () => ({
      full_name: 'Octo/api',
      clone_url: 'https://github.com/Octo/api.git',
    }))
    const client = createGitHubClient('token', fetchMock)

    await client.createRepository({
      owner: 'Octo',
      name: 'api',
      private: false,
      authenticatedUser: 'octo',
    })

    expect(fetchMock).toHaveBeenCalledWith('/user/repos', expect.objectContaining({
      method: 'POST',
    }))
  })

  test('creates organization repositories', async () => {
    const fetchMock = mock(async () => ({
      full_name: 'acme/api',
      clone_url: 'https://github.com/acme/api.git',
    }))
    const client = createGitHubClient('token', fetchMock)

    await client.createRepository({
      owner: 'acme',
      name: 'api',
      private: true,
      authenticatedUser: 'octo',
    })

    expect(fetchMock).toHaveBeenCalledWith('/orgs/acme/repos', expect.objectContaining({
      method: 'POST',
      body: {
        name: 'api',
        private: true,
      },
    }))
  })
})
