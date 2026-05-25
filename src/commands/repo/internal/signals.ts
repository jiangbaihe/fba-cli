import {
  restoreRepoInitSnapshot,
  type RepoInitSnapshot,
} from './transaction.js'
import { formatErrorMessage } from './display.js'

type RepoInitSignal = 'SIGINT' | 'SIGTERM'

interface SignalTarget {
  once(signal: RepoInitSignal, listener: () => void): unknown
  off(signal: RepoInitSignal, listener: () => void): unknown
}

export function installRepoInitRollbackSignalHandlers(input: {
  snapshot: RepoInitSnapshot
  restore?: (snapshot: RepoInitSnapshot) => Promise<void>
  target?: SignalTarget
  exit?: (code: number) => void
  warn?: (message: string) => void
  rollbackFailedMessage?: string
}): () => void {
  const target = input.target ?? process
  const restore = input.restore ?? restoreRepoInitSnapshot
  const exit = input.exit ?? ((code: number) => process.exit(code))
  const warn = input.warn ?? (() => {})
  let active = true

  const dispose = () => {
    if (!active) return
    active = false
    target.off('SIGINT', onSigint)
    target.off('SIGTERM', onSigterm)
  }

  const rollbackAndExit = (code: number) => {
    if (!active) return
    active = false
    target.off('SIGINT', onSigint)
    target.off('SIGTERM', onSigterm)

    void restore(input.snapshot)
      .catch((error) => {
        if (input.rollbackFailedMessage) warn(input.rollbackFailedMessage)
        warn(formatErrorMessage(error))
      })
      .finally(() => exit(code))
  }

  function onSigint(): void {
    rollbackAndExit(130)
  }

  function onSigterm(): void {
    rollbackAndExit(143)
  }

  target.once('SIGINT', onSigint)
  target.once('SIGTERM', onSigterm)
  return dispose
}
