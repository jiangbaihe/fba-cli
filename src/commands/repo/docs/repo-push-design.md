# 实验性仓库推送设计

## 目标

`fba-cli repo push` 是实验性仓库维护流程中的发布步骤。

它负责推送已经准备好的本地提交：

- 后端仓库
- 前端仓库
- 主仓库

该命令只发布干净的本地历史。它不会修复本地状态、创建提交、merge、rebase、pull 或 force push。

## 边界

`repo push` 是唯一允许执行 `git push` 的 repo 子命令。

实现收在 repo 模块内：

```text
src/commands/repo/push.ts
src/commands/repo/internal/push-runtime.ts
src/commands/repo/internal/push-inspection.ts
src/commands/repo/internal/push.ts
src/commands/repo/internal/git.ts
```

顶层命令文件只做薄入口。检查、规划、dry-run 执行、真实 push 执行和摘要逻辑都放在 `src/commands/repo/internal/`。

## 项目解析

命令沿用 fba-cli 现有项目解析规则：

1. 显式全局参数 `-p, --project <dir>`
2. 从当前工作目录向上查找最近的 `.fba.json`
3. 全局配置 `~/.fba.json` 中的当前项目

目标项目必须包含真实的 `.fba.json`，并包含：

- `name`
- `backend_name`
- `frontend_name`

在本地检查或 dry-run push 前，向导会展示解析出的项目，并要求用户确认。

## 推送顺序

推送顺序为：

1. backend
2. frontend
3. main

主仓最后推送，因为主仓子模块 gitlink 可能指向后端/前端提交。子仓提交应先存在于远程，主仓再发布指向它们的指针。

## 前置条件

每个仓库都必须满足：

- 目录存在
- 目录是 Git 仓库根目录
- 工作区干净
- 当前分支不是 detached HEAD
- 已配置 `origin` remote

后端和前端还应满足：

- 仓库不是浅克隆
- `upstream` 应指向官方 FBA 仓库
- upstream 不一致是警告，不是硬阻断

主仓还应满足：

- `.gitmodules` 存在
- 后端/前端 `.gitmodules` URL 与子仓 `origin` URL 一致
- 子模块指针变化已经提交

`repo push` 不会自动 stage 或 commit 子模块指针变化。

## dry-run

任何真实 push 前，命令会对每个仓库执行 dry-run：

```bash
git push --dry-run origin HEAD:<branch>
```

如果任一 dry-run 失败，不会执行真实 push。

dry-run 可以降低部分推送风险，但无法完全消除远程竞争。因此真实 push 阶段仍然会在第一个失败处立即停止。

## 最终确认

本地检查和所有 dry-run 都通过后，向导会展示：

- 项目名称和路径
- 仓库角色
- 每个仓库的分支
- 每个仓库的 `origin` URL
- 推送顺序
- 不会执行 merge、pull、commit、tag push 或 force push 的提示

只有用户明确确认后，才进入真实 push 阶段。确认默认值应保持保守。

## 应用阶段

按推送顺序对每个仓库执行：

```bash
git push -u origin HEAD:<branch>
```

`-u` 会为首次推送设置 upstream tracking；如果 tracking 已存在，也不会造成问题。

不会推送 tag。

## 失败行为

`repo push` 没有远程回滚能力。

如果 dry-run 失败：

- 不推送任何仓库
- 展示失败仓库
- 提示用户修复本地或远程状态后重新运行

如果真实 push 失败：

- 立即停止后续处理
- 展示已经推送的仓库
- 展示尚未推送的仓库
- 提示用户修复问题后重新运行

## 完成输出

成功后展示每个已推送仓库，并建议检查本地状态：

```bash
fba-cli repo status
```

## 发布打包

当前 fork 使用 GitHub Release 包安装：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
```

Release 资产固定命名为 `fba-cli.tgz`，用户不需要记具体版本号。源码仓库不提交 `dist/` 或 `.tgz`，发布包中必须包含已经构建好的 `dist/index.js`。

发布由 tag 触发 GitHub Actions：

```powershell
git tag repo-v0.1.10
git push origin repo-v0.1.10
```

不要为实验性版本推送 `v*` tag。`v*` tag 属于原项目 `.github/workflows/release.yml` 的 npm 发布流程，在 fork 中可能触发一个没有 `NPM_TOKEN` 或 npm 发布权限的失败 workflow。

Actions 会自动执行：

- `bun test --isolate`
- `pnpm run typecheck`
- `git diff --check`
- `pnpm run build`
- `npm pack`
- 上传固定资产 `fba-cli.tgz`

完整流程见 `repo-release-design.md`。

发布后验证：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
fba-cli repo --help
```

## 测试

测试不得使用真实远程 push。

覆盖重点：

- dry-run 前必须先确认项目
- 最终确认前不会真实 push
- 推送顺序为 backend、frontend、main
- 脏工作区阻止 push
- 缺少 `origin` 阻止 push
- detached HEAD 阻止 push
- 浅克隆子仓阻止 push
- `.gitmodules` 问题阻止 push
- upstream 不一致只作为警告
- dry-run 失败会阻止所有真实 push
- 真实 push 在第一个失败处停止

验证命令：

```bash
bun test
bunx tsc --noEmit
git diff --check
```
