import { readFileSync } from 'fs'
import { join } from 'path'

export interface StrictProjectConfig {
  name: string
  backend_name: string
  frontend_name: string
}

export function readStrictProjectConfig(projectDir: string): StrictProjectConfig {
  const configPath = join(projectDir, '.fba.json')
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    name?: unknown
    backend_name?: unknown
    frontend_name?: unknown
  }

  if (
    typeof raw.name !== 'string' ||
    raw.name.trim() === '' ||
    typeof raw.backend_name !== 'string' ||
    raw.backend_name.trim() === '' ||
    typeof raw.frontend_name !== 'string' ||
    raw.frontend_name.trim() === ''
  ) {
    throw new Error('.fba.json must include name, backend_name, and frontend_name')
  }

  return {
    name: raw.name,
    backend_name: raw.backend_name,
    frontend_name: raw.frontend_name,
  }
}
