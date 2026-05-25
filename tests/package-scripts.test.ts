import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const rootDir = join(import.meta.dir, '..')
const packageJson = JSON.parse(
  readFileSync(join(rootDir, 'package.json'), 'utf-8'),
) as {
  bin?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
}
const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8')
const releaseWorkflow = readFileSync(join(rootDir, '.github', 'workflows', 'release.yml'), 'utf-8')
const repoReleaseWorkflow = readFileSync(
  join(rootDir, '.github', 'workflows', 'repo-release.yml'),
  'utf-8',
)
const repoReadme = readFileSync(join(rootDir, 'src', 'commands', 'repo', 'README.md'), 'utf-8')
const repoReleaseDesign = readFileSync(
  join(rootDir, 'src', 'commands', 'repo', 'docs', 'repo-release-design.md'),
  'utf-8',
)

describe('package scripts', () => {
  test('keeps package metadata aligned with built release artifacts', () => {
    expect(packageJson.bin?.['fba-cli']).toBe('./dist/index.js')
    expect(packageJson.scripts?.build).toBe(
      'tsup src/index.ts --format esm --out-dir dist --target node18 --clean',
    )
    expect(packageJson.scripts?.prepublishOnly).toBe('npm run typecheck && npm run build')
    expect(packageJson.scripts?.prepare).toBeUndefined()
    expect(packageJson.files).toContain('dist')
  })

  test('keeps generated release artifacts out of source commits', () => {
    expect(gitignore).toContain('\ndist\n')
    expect(gitignore).toContain('\n*.tgz\n')
  })

  test('keeps the upstream npm release workflow unchanged', () => {
    expect(releaseWorkflow).toContain('tags:')
    expect(releaseWorkflow).toContain('"v*"')
    expect(releaseWorkflow).toContain('pnpm publish --provenance --access public --no-git-checks')
    expect(releaseWorkflow).toContain('NPM_TOKEN')
    expect(releaseWorkflow).not.toContain('fba-cli.tgz')
  })

  test('publishes repo experimental GitHub Release assets from a separate workflow', () => {
    expect(repoReleaseWorkflow).toContain('repo-latest')
    expect(repoReleaseWorkflow).toContain('fba-cli.tgz')
    expect(repoReleaseWorkflow).toContain('softprops/action-gh-release')
    expect(repoReleaseWorkflow).toContain('oven-sh/setup-bun')
    expect(repoReleaseWorkflow).toContain('pnpm install --frozen-lockfile')
    expect(repoReleaseWorkflow).toContain('bun test --isolate')
    expect(repoReleaseWorkflow).toContain('pnpm run typecheck')
    expect(repoReleaseWorkflow).toContain('pnpm run build')
    expect(repoReleaseWorkflow).toContain('overwrite_files: true')
    expect(repoReleaseWorkflow).toContain('make_latest: false')
    expect(repoReleaseWorkflow).not.toContain('pnpm publish')
    expect(repoReleaseWorkflow).not.toContain('NPM_TOKEN')
  })

  test('uses fixed repo-latest release download URLs in experimental install docs', () => {
    const installDocs = `${repoReadme}\n${repoReleaseDesign}`

    expect(installDocs).not.toContain('/releases/latest/download/')
    expect(installDocs).toContain('/releases/download/repo-latest/fba-cli.tgz')
    expect(installDocs).not.toContain('/releases/download/repo-v')
  })
})
