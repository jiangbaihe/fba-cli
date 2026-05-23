import { execa } from 'execa'
import * as clack from '@clack/prompts'
import chalk from 'chalk'

export interface RepoRunOptions {
  cwd?: string
  label?: string
  spinner?: boolean
  env?: Record<string, string>
  stdio?: 'pipe' | 'inherit'
  input?: string
  timeout?: number
  showErrorOutput?: boolean
}

function getErrorTail(output: string, maxLines = 8): string {
  const lines = output.trim().split('\n')
  if (lines.length <= maxLines) return output.trim()
  return `  ...\n${lines.slice(-maxLines).join('\n')}`
}

export async function run(
  cmd: string,
  args: string[] = [],
  opts: RepoRunOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const spinner = opts.spinner ? clack.spinner() : null
  const label = opts.label ?? `${cmd} ${args.join(' ')}`.trim()
  spinner?.start(label)

  try {
    const result = await execa(cmd, args, {
      cwd: opts.cwd,
      stdio: opts.spinner ? 'pipe' : (opts.stdio ?? 'inherit'),
      env: opts.env,
      input: opts.input,
      timeout: opts.timeout,
      reject: false,
    })

    if (result.exitCode !== 0) {
      spinner?.stop(chalk.red(`${label} ✗`))

      if (opts.showErrorOutput !== false) {
        const output = (result.stderr ?? '').trim() || (result.stdout ?? '').trim()
        if (output) {
          console.error(chalk.dim(`  Command: ${cmd} ${args.join(' ')}`))
          if (opts.cwd) console.error(chalk.dim(`  CWD: ${opts.cwd}`))
          console.error(chalk.dim(`  Exit code: ${result.exitCode}`))
          console.error(chalk.red(getErrorTail(output)))
        }
      }

      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 1,
      }
    }

    spinner?.stop(chalk.green(`${label} ✓`))
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: 0,
    }
  } catch (error: any) {
    spinner?.stop(chalk.red(`${label} ✗`))

    if (opts.showErrorOutput !== false) {
      console.error(chalk.dim(`  Command: ${cmd} ${args.join(' ')}`))
      console.error(chalk.red(`  ${error.message ?? String(error)}`))
    }

    return {
      stdout: '',
      stderr: error.message ?? String(error),
      exitCode: 1,
    }
  }
}
