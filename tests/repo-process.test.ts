import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const execaMock = mock(async () => ({ stdout: '', stderr: '', exitCode: 0 }))

mock.module('execa', () => ({
  execa: execaMock,
}))

const { run } = await import('../src/commands/repo/internal/process.ts')

describe('repo process runner', () => {
  const originalConsoleError = console.error
  const consoleErrorMock = mock(() => {})

  beforeEach(() => {
    execaMock.mockReset()
    consoleErrorMock.mockReset()
    console.error = consoleErrorMock as unknown as typeof console.error
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  test('redacts credentials and tokens from failed command logs', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: '',
      stderr: [
        'fatal: Authentication failed for https://user:ghp_secret1234567890abcdef@github.com/acme/repo.git',
        'Authorization: Bearer ghp_secret1234567890abcdef',
        'AUTHORIZATION: basic dXNlcjpnaHBfc2VjcmV0MTIzNDU2Nzg5MGFiY2RlZg==',
      ].join('\n'),
      exitCode: 1,
    })

    await run('git', [
      'fetch',
      'https://user:ghp_secret1234567890abcdef@github.com/acme/repo.git',
    ], { stdio: 'pipe' })

    const output = consoleErrorMock.mock.calls.flat().join('\n')
    expect(output).not.toContain('ghp_secret1234567890abcdef')
    expect(output).not.toContain('dXNlcjpnaHBfc2VjcmV0MTIzNDU2Nzg5MGFiY2RlZg==')
    expect(output).toContain('https://***@github.com/acme/repo.git')
    expect(output).toContain('Authorization: Bearer ***')
    expect(output).toContain('AUTHORIZATION: basic ***')
  })
})
