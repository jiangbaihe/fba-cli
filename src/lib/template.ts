// template.ts — 插件模板引擎
import { readdir, readFile, writeFile, cp, rename, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export interface TemplateVars {
  name: string
  summary: string
  version: string
  description: string
  author: string
  [key: string]: string
}

/**
 * 获取 CLI 包内置的 templates 目录路径
 */
export function getTemplatesDir(): string {
  return resolveTemplatesDir(import.meta.url)
}

/**
 * 从运行模块位置向上查找包内 templates 目录。
 * 支持源码运行 (src/lib/template.ts) 和打包后运行 (dist/*.js)。
 */
export function resolveTemplatesDir(moduleUrl: string): string {
  let currentDir = dirname(fileURLToPath(moduleUrl))

  while (true) {
    const candidate = join(currentDir, 'templates')
    if (
      existsSync(join(candidate, 'web'))
      && existsSync(join(candidate, 'server'))
    ) {
      return candidate
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  throw new Error(
    `Unable to locate templates directory from ${fileURLToPath(moduleUrl)}`,
  )
}

/**
 * 从 templates/ 复制并渲染插件模板到目标目录
 *
 * @param templateType 模板类型: 'server' | 'web'
 * @param targetDir 目标插件目录 (绝对路径)
 * @param vars 模板变量
 * @param options 额外选项 (后端插件级别)
 */
export async function renderTemplate(
  templateType: 'server' | 'web',
  targetDir: string,
  vars: TemplateVars,
  options?: { serverType?: 'app' | 'ext' },
): Promise<void> {
  const srcDir = join(getTemplatesDir(), templateType)

  // 1. 递归复制模板目录
  await cp(srcDir, targetDir, { recursive: true })

  // 2. 处理 server 模板的 TOML 选择
  if (templateType === 'server' && options?.serverType) {
    const keep = options.serverType === 'app' ? 'plugin.app.toml' : 'plugin.ext.toml'
    const remove = options.serverType === 'app' ? 'plugin.ext.toml' : 'plugin.app.toml'

    const keepPath = join(targetDir, keep)
    const removePath = join(targetDir, remove)
    const finalPath = join(targetDir, 'plugin.toml')

    await rename(keepPath, finalPath)
    await rm(removePath, { force: true })
  }

  // 3. 递归替换所有文件内容 & 文件名中的 {{var}}
  await walkAndReplace(targetDir, vars)
}

/**
 * 递归遍历目录，替换文件名和文件内容中的 {{var}} 占位符
 */
async function walkAndReplace(dir: string, vars: TemplateVars): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    // 替换文件/目录名中的 {{xxx}}
    const newName = replaceVars(entry.name, vars)
    const newPath = newName !== entry.name ? join(dir, newName) : fullPath
    if (newName !== entry.name) {
      await rename(fullPath, newPath)
    }

    if (entry.isDirectory()) {
      await walkAndReplace(newPath, vars)
    } else {
      // 只对文本文件替换内容
      if (isTextFile(newPath)) {
        const content = await readFile(newPath, 'utf-8')
        const replaced = replaceVars(content, vars)
        if (replaced !== content) {
          await writeFile(newPath, replaced)
        }
      }
    }
  }
}

/**
 * 替换 {{var}} 占位符
 */
function replaceVars(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match: string, key: string): string => {
    return key in vars ? vars[key]! : match
  })
}

/**
 * 判断是否是文本文件（根据扩展名）
 */
function isTextFile(filePath: string): boolean {
  const textExts = [
    '.ts', '.js', '.json', '.toml', '.yml', '.yaml',
    '.md', '.txt', '.py', '.vue', '.html', '.css',
    '.env', '.sql', '.cfg', '.ini', '.sh',
  ]
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  // 无扩展名的文件也作为文本处理 (如 __init__.py 等)
  return textExts.includes(ext) || !ext || ext === filePath
}
