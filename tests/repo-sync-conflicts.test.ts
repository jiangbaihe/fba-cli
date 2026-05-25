import { beforeEach, describe, expect, mock, test } from 'bun:test'

const selectMock = mock(async () => 'manual')
const noteMock = mock(() => {})
const abortMergeMock = mock(async () => true)
const abortRebaseMock = mock(async () => true)
const checkoutConflictSideMock = mock(async () => true)
const commitNoEditMock = mock(async () => true)
const continueRebaseMock = mock(async () => true)
const getConflictedPathsMock = mock(async () => ['app.py'])
const stagePathsMock = mock(async () => true)

mock.module('@clack/prompts', () => ({
  note: noteMock,
  select: selectMock,
}))

mock.module('../src/commands/repo/internal/git.ts', () => ({
  abortMerge: abortMergeMock,
  abortRebase: abortRebaseMock,
  checkoutConflictSide: checkoutConflictSideMock,
  commitNoEdit: commitNoEditMock,
  continueRebase: continueRebaseMock,
  getConflictedPaths: getConflictedPathsMock,
  stagePaths: stagePathsMock,
}))

const {
  handleConflict,
} = await import('../src/commands/repo/internal/sync-conflicts.ts')

function noteText(): string {
  return noteMock.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('repo sync conflict handling', () => {
  beforeEach(() => {
    selectMock.mockReset()
    selectMock.mockImplementation(async () => 'manual')
    noteMock.mockReset()
    abortMergeMock.mockReset()
    abortMergeMock.mockImplementation(async () => true)
    abortRebaseMock.mockReset()
    abortRebaseMock.mockImplementation(async () => true)
    checkoutConflictSideMock.mockReset()
    checkoutConflictSideMock.mockImplementation(async () => true)
    commitNoEditMock.mockReset()
    commitNoEditMock.mockImplementation(async () => true)
    continueRebaseMock.mockReset()
    continueRebaseMock.mockImplementation(async () => true)
    getConflictedPathsMock.mockReset()
    getConflictedPathsMock.mockImplementation(async () => ['app.py'])
    stagePathsMock.mockReset()
    stagePathsMock.mockImplementation(async () => true)
  })

  test('treats a cancelled conflict prompt as manual recovery', async () => {
    const cancelled = Symbol('cancelled')
    selectMock.mockResolvedValueOnce(cancelled as never)

    const result = await handleConflict({
      dir: 'repo',
      label: 'Backend',
      operation: 'rebase',
      isCancelled: (value) => value === cancelled,
    })

    expect(result).toBe('stopped')
    expect(noteText()).toContain('git -C repo status')
    expect(noteText()).toContain('git -C repo rebase --continue')
    expect(noteText()).toContain('git -C repo rebase --abort')
  })

  test('prints manual rebase recovery when automatic resolution cannot finish', async () => {
    selectMock.mockResolvedValueOnce('local')
    continueRebaseMock.mockResolvedValueOnce(false)

    const result = await handleConflict({
      dir: 'repo',
      label: 'Backend',
      operation: 'rebase',
      isCancelled: () => false,
    })

    expect(result).toBe('stopped')
    expect(checkoutConflictSideMock).toHaveBeenCalledWith('repo', 'theirs', ['app.py'])
    expect(stagePathsMock).toHaveBeenCalledWith('repo', ['app.py'])
    expect(noteText()).toContain('git -C repo rebase --continue')
    expect(noteText()).toContain('git -C repo rebase --abort')
  })

  test('prints manual recovery when checking out the chosen conflict side fails', async () => {
    selectMock.mockResolvedValueOnce('incoming')
    checkoutConflictSideMock.mockResolvedValueOnce(false)

    const result = await handleConflict({
      dir: 'repo',
      label: 'Backend',
      operation: 'merge',
      isCancelled: () => false,
    })

    expect(result).toBe('stopped')
    expect(stagePathsMock).not.toHaveBeenCalled()
    expect(noteText()).toContain('git -C repo status')
    expect(noteText()).toContain('git -C repo commit --no-edit')
    expect(noteText()).toContain('git -C repo merge --abort')
  })

  test('prints manual recovery when staging resolved conflicts fails', async () => {
    selectMock.mockResolvedValueOnce('incoming')
    stagePathsMock.mockResolvedValueOnce(false)

    const result = await handleConflict({
      dir: 'repo',
      label: 'Backend',
      operation: 'merge',
      isCancelled: () => false,
    })

    expect(result).toBe('stopped')
    expect(checkoutConflictSideMock).toHaveBeenCalledWith('repo', 'theirs', ['app.py'])
    expect(noteText()).toContain('git -C repo status')
    expect(noteText()).toContain('git -C repo commit --no-edit')
    expect(noteText()).toContain('git -C repo merge --abort')
  })
})
