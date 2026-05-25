import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const projectRoot = join(tmpdir(), `fba-create-repo-signals-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const projectName = 'demo'
const projectDir = join(projectRoot, projectName)
const confirmMock = mock(async () => false)
const groupMock = mock(async () => ({}))
const selectMock = mock(async () => 'postgresql')
const runRepoInitForCreateMock = mock(async () => true)

mock.module('@clack/prompts', () => ({
  intro: mock(() => {}),
  outro: mock(() => {}),
  note: mock(() => {}),
  select: selectMock,
  text: mock(async () => ''),
  confirm: confirmMock,
  group: groupMock,
  multiselect: mock(async () => []),
  isCancel: mock(() => false),
  spinner: mock(() => ({
    start: mock(() => {}),
    stop: mock(() => {}),
  })),
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
    step: mock(() => {}),
    success: mock(() => {}),
    warn: mock(() => {}),
  },
}))

mock.module('../src/lib/config.ts', () => ({
  readGlobalConfig: mock(() => ({
    npmRegistry: 'https://registry.npmjs.org',
    pypiRegistry: 'https://pypi.org/simple',
  })),
  writeGlobalConfig: mock(() => {}),
  isFirstRun: mock(() => false),
  addProject: mock(() => {}),
  writeProjectConfig: mock(() => {}),
}))

mock.module('../src/lib/env-check.ts', () => ({
  checkEnvironment: mock(async () => ({})),
  getMissingTools: mock(() => []),
  getMissingRequiredTools: mock(() => []),
}))

mock.module('../src/lib/env-install.ts', () => ({
  installTool: mock(async () => true),
}))

mock.module('../src/lib/git.ts', () => ({
  gitClone: mock(async () => true),
}))

mock.module('../src/commands/repo/internal/create-integration.ts', () => ({
  cloneRepositoryForMaintenance: mock(async (_url: string, targetDir: string) => {
    mkdirSync(join(targetDir, 'backend'), { recursive: true })
    mkdirSync(join(targetDir, 'apps', 'web-antdv-next'), { recursive: true })
    return true
  }),
  runRepoInitForCreate: runRepoInitForCreateMock,
  repoCreateText: {
    maintenanceQuestion: () => 'Enable repo maintenance?',
    initNowQuestion: () => 'Run repo init now?',
    initFailedHint: () => 'repo init failed',
  },
}))

mock.module('../src/lib/docker.ts', () => ({
  isDockerAvailable: mock(async () => false),
  composeUp: mock(async () => true),
  composeDown: mock(async () => true),
}))

mock.module('../src/lib/infra.ts', () => ({
  DEFAULT_INFRA_CONFIG: {
    dbHost: '127.0.0.1',
    dbPort: 5432,
    dbUser: 'postgres',
    dbPassword: 'postgres',
    redisHost: '127.0.0.1',
    redisPort: 6379,
    redisPassword: '',
    mqHost: '127.0.0.1',
    mqPort: 5672,
    mqManagePort: 15672,
    mqUser: 'guest',
    mqPassword: 'guest',
  },
  createInfraDir: mock(() => {}),
  getDefaultsForDbType: mock(() => ({})),
}))

mock.module('../src/templates/backend.env.ts', () => ({
  getDefaultBackendEnv: mock(() => ({})),
  serializeBackendEnv: mock(() => 'DATABASE_URL=\n'),
}))

mock.module('../src/lib/process.ts', () => ({
  run: mock(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  runInherited: mock(async () => 0),
}))

mock.module('../src/lib/registry.ts', () => ({
  NPM_REGISTRIES: [],
  PYPI_REGISTRIES: [],
  getRegistryLabel: mock(() => 'default'),
  selectNpmRegistry: mock(async () => 'https://registry.npmjs.org'),
  selectPypiRegistry: mock(async () => 'https://pypi.org/simple'),
}))

const { createAction } = await import('../src/commands/create.ts')

describe('create repo integration signal handling', () => {
  const originalExit = process.exit
  const exitMock = mock((_code?: string | number | null) => undefined as never)

  beforeEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    mkdirSync(projectRoot, { recursive: true })
    confirmMock.mockReset()
    confirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    groupMock.mockReset()
    groupMock
      .mockResolvedValueOnce({
        projectRoot,
        projectName,
        backendName: 'backend',
        frontendName: 'frontend',
      })
      .mockResolvedValueOnce({
        dbHost: '127.0.0.1',
        dbPort: '5432',
        dbUser: 'postgres',
        dbPassword: 'postgres',
      })
      .mockResolvedValueOnce({
        redisHost: '127.0.0.1',
        redisPort: '6379',
        redisPassword: '',
      })
      .mockResolvedValueOnce({
        mqHost: '127.0.0.1',
        mqPort: '5672',
        mqManagePort: '15672',
        mqUser: 'guest',
        mqPassword: 'guest',
      })
      .mockResolvedValueOnce({
        serverPort: '8000',
        webPort: '5173',
      })
    selectMock.mockReset()
    selectMock.mockResolvedValue('postgresql')
    runRepoInitForCreateMock.mockReset()
    exitMock.mockClear()
    process.exit = exitMock as typeof process.exit
  })

  afterEach(() => {
    process.exit = originalExit
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test('lets nested repo init own SIGINT rollback after create has completed project setup', async () => {
    let nestedSignalHandled = false
    runRepoInitForCreateMock.mockImplementationOnce(async () => {
      process.once('SIGINT', () => {
        nestedSignalHandled = true
      })
      process.emit('SIGINT')
      await Promise.resolve()
      return false
    })

    await createAction()

    expect(nestedSignalHandled).toBe(true)
    expect(exitMock).not.toHaveBeenCalled()
    expect(existsSync(projectDir)).toBe(true)
  })
})
