import { readFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { formatErrorMessage } from './display.js'

export interface StrictProjectConfig {
  name: string
  backend_name: string
  frontend_name: string
}

export function readStrictProjectConfig(projectDir: string): StrictProjectConfig {
  const configPath = join(projectDir, '.fba.json')
  let raw: {
    name?: unknown
    backend_name?: unknown
    frontend_name?: unknown
  }
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8')) as typeof raw
  } catch (error) {
    throw new Error(`Unable to read .fba.json: ${formatErrorMessage(error)}`)
  }

  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof raw.name !== 'string' ||
    raw.name.trim() === '' ||
    typeof raw.backend_name !== 'string' ||
    raw.backend_name.trim() === '' ||
    typeof raw.frontend_name !== 'string' ||
    raw.frontend_name.trim() === ''
  ) {
    throw new Error('.fba.json must include name, backend_name, and frontend_name')
  }

  const name = raw.name.trim()
  const backendName = raw.backend_name.trim()
  const frontendName = raw.frontend_name.trim()

  if (
    !isPlainDirectoryName(backendName) ||
    !isPlainDirectoryName(frontendName)
  ) {
    throw new Error('.fba.json backend_name and frontend_name must be plain directory names')
  }

  if (isSameChildDirectory(projectDir, backendName, frontendName)) {
    throw new Error('.fba.json backend_name and frontend_name must be different')
  }

  return {
    name,
    backend_name: backendName,
    frontend_name: frontendName,
  }
}

function isPlainDirectoryName(value: string): boolean {
  const name = value.trim()
  if (!name || name === '.' || name === '..') return false
  if (isAbsolute(name)) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (/[\s"'`]/.test(name)) return false
  return true
}

function isSameChildDirectory(projectDir: string, backendName: string, frontendName: string): boolean {
  const backendPath = resolve(projectDir, backendName)
  const frontendPath = resolve(projectDir, frontendName)
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return backendPath.toLowerCase() === frontendPath.toLowerCase()
  }
  return backendPath === frontendPath
}
