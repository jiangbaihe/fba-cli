import { beforeEach, describe, expect, mock, test } from 'bun:test'

const runMock = mock(async () => ({ stdout: '', stderr: '', exitCode: 0 }))

mock.module('../src/lib/process.ts', () => ({
  run: runMock,
}))

const { gitClone } = await import('../src/lib/git.ts')

describe('gitClone', () => {
  beforeEach(() => {
    runMock.mockClear()
  })

  test('uses a shallow clone by default', async () => {
    const ok = await gitClone('https://example.test/repo.git', 'target-dir')

    expect(ok).toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', 'https://example.test/repo.git', 'target-dir'],
      {
        spinner: true,
        label: 'Cloning https://example.test/repo.git',
      },
    )
  })

  test('keeps branch selection on shallow clones', async () => {
    const ok = await gitClone('https://example.test/repo.git', 'target-dir', {
      branch: 'main',
      label: 'Clone main',
    })

    expect(ok).toBe(true)
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['clone', '-b', 'main', '--depth', '1', 'https://example.test/repo.git', 'target-dir'],
      {
        spinner: true,
        label: 'Clone main',
      },
    )
  })
})
