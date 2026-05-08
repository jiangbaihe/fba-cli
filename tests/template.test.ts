import { describe, expect, test } from 'bun:test'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { resolveTemplatesDir } from '../src/lib/template.ts'

const repoRoot = resolve(import.meta.dir, '..')

describe('resolveTemplatesDir', () => {
  test('resolves templates from the source module location', () => {
    const sourceUrl = pathToFileURL(resolve(repoRoot, 'src/lib/template.ts')).href

    expect(resolveTemplatesDir(sourceUrl)).toBe(resolve(repoRoot, 'templates'))
  })

  test('resolves templates from the bundled dist module location', () => {
    const bundledUrl = pathToFileURL(resolve(repoRoot, 'dist/create-EXAMPLE.js')).href

    expect(resolveTemplatesDir(bundledUrl)).toBe(resolve(repoRoot, 'templates'))
  })
})
