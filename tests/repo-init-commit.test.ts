import { beforeEach, describe, expect, mock, test } from 'bun:test'

const runMock = mock(async () => ({ stdout: '', stderr: '', exitCode: 0 }))

mock.module('../src/commands/repo/internal/process.ts', () => ({
  run: runMock,
}))

const { createLocalInitCommit } = await import('../src/commands/repo/internal/init-operations.ts')

describe('repo init local commit helper', () => {
  beforeEach(() => {
    runMock.mockClear()
  })

  test('stages repository metadata before creating the local commit', async () => {
    await expect(createLocalInitCommit('project', {
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    })).resolves.toBe(true)

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['add', '.gitmodules', 'server', 'web'],
      expect.objectContaining({ cwd: 'project' }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      'git',
      [
        'commit',
        '-m',
        'chore: initialize repository remotes',
        '--',
        '.gitmodules',
        'server',
        'web',
      ],
      expect.objectContaining({ cwd: 'project' }),
    )
  })

  test('returns false when staging fails', async () => {
    runMock.mockResolvedValueOnce({ stdout: '', stderr: 'add failed', exitCode: 1 })

    await expect(createLocalInitCommit('project', {
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    })).resolves.toBe(false)

    expect(runMock).toHaveBeenCalledTimes(1)
  })

  test('returns false when commit fails', async () => {
    runMock
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'missing identity', exitCode: 1 })

    await expect(createLocalInitCommit('project', {
      name: 'jubao-mes',
      backend_name: 'server',
      frontend_name: 'web',
    })).resolves.toBe(false)

    expect(runMock).toHaveBeenCalledTimes(2)
  })
})
