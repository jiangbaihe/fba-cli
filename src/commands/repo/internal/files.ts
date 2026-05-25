import { existsSync, readdirSync, readFileSync } from 'fs'
import { formatErrorMessage } from './display.js'

export function readOptionalTextFile(path: string): string | null {
  if (!existsSync(path)) return null

  try {
    return readFileSync(path, 'utf-8')
  } catch (error) {
    throw new Error(`Unable to read ${path}: ${formatErrorMessage(error)}`)
  }
}

export function isDirectoryEmpty(path: string): boolean {
  try {
    return existsSync(path) && readdirSync(path).length === 0
  } catch {
    return false
  }
}
