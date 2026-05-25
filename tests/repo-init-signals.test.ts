import { describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'events'
import {
  installRepoInitRollbackSignalHandlers,
} from '../src/commands/repo/internal/signals.ts'
import type { RepoInitSnapshot } from '../src/commands/repo/internal/transaction.ts'

const snapshot = {} as RepoInitSnapshot

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('repo init signal rollback', () => {
  test('rolls back and exits with 130 on SIGINT', async () => {
    const target = new EventEmitter()
    const restoreMock = mock(async () => {})
    const exitMock = mock(() => {})

    installRepoInitRollbackSignalHandlers({
      snapshot,
      target,
      restore: restoreMock,
      exit: exitMock,
    })
    target.emit('SIGINT')
    await flushMicrotasks()

    expect(restoreMock).toHaveBeenCalledWith(snapshot)
    expect(exitMock).toHaveBeenCalledWith(130)
    expect(target.listenerCount('SIGINT')).toBe(0)
    expect(target.listenerCount('SIGTERM')).toBe(0)
  })

  test('rolls back and exits with 143 on SIGTERM', async () => {
    const target = new EventEmitter()
    const restoreMock = mock(async () => {})
    const exitMock = mock(() => {})

    installRepoInitRollbackSignalHandlers({
      snapshot,
      target,
      restore: restoreMock,
      exit: exitMock,
    })
    target.emit('SIGTERM')
    await flushMicrotasks()

    expect(restoreMock).toHaveBeenCalledWith(snapshot)
    expect(exitMock).toHaveBeenCalledWith(143)
  })

  test('disposes handlers after normal command completion', async () => {
    const target = new EventEmitter()
    const restoreMock = mock(async () => {})
    const exitMock = mock(() => {})
    const dispose = installRepoInitRollbackSignalHandlers({
      snapshot,
      target,
      restore: restoreMock,
      exit: exitMock,
    })

    dispose()
    target.emit('SIGINT')
    await flushMicrotasks()

    expect(restoreMock).not.toHaveBeenCalled()
    expect(exitMock).not.toHaveBeenCalled()
    expect(target.listenerCount('SIGINT')).toBe(0)
    expect(target.listenerCount('SIGTERM')).toBe(0)
  })

  test('still exits when rollback fails after an interrupt', async () => {
    const target = new EventEmitter()
    const restoreMock = mock(async () => {
      throw new Error('rollback failed')
    })
    const exitMock = mock(() => {})
    const warnMock = mock(() => {})

    installRepoInitRollbackSignalHandlers({
      snapshot,
      target,
      restore: restoreMock,
      exit: exitMock,
      warn: warnMock,
      rollbackFailedMessage: 'rollback incomplete',
    })
    target.emit('SIGINT')
    await flushMicrotasks()

    expect(warnMock).toHaveBeenCalledWith('rollback incomplete')
    expect(warnMock).toHaveBeenCalledWith('rollback failed')
    expect(exitMock).toHaveBeenCalledWith(130)
  })
})
