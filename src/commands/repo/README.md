# 实验性仓库维护

`fba-cli repo` 是一组实验性工作流，用于维护 FBA 项目的主仓、后端子仓、前端子仓，以及它们的 `origin` / `upstream` 远程关系。

这个功能刻意收在当前目录内。命令入口位于 `src/commands/repo/*.ts`，具体实现位于 `src/commands/repo/internal/`，设计说明位于 `src/commands/repo/docs/`。

## 命令

```bash
fba-cli repo init
```

初始化本地仓库维护配置。它会检查或创建 GitHub 仓库，修正本地 `origin` 和 `upstream` 远程，写入 `.gitmodules`，并把浅克隆的子仓转成完整历史。它不会执行 push。

```bash
fba-cli repo status
```

执行只读的本地健康检查。它不会 fetch、push、创建仓库或修改文件。

```bash
fba-cli repo sync
```

执行向导式同步流程。它先检查主仓 `origin`，再检查后端和前端 `origin`，然后询问是否跟随官方 `upstream`。它可以引导用户选择 fast-forward、rebase、merge、skip、cancel 或冲突处理方式。它不会 push、不会自动 stash、不会 force。

```bash
fba-cli repo push
```

发布已经整理干净的本地提交。它会检查仓库状态，执行 dry-run push，再次确认后按后端、前端、主仓顺序推送。它不会自动 stage、commit、pull、merge、rebase、推送 tag 或 force push。

## 设计文档

- `docs/repo-init-design.md`
- `docs/repo-sync-design.md`
- `docs/repo-push-design.md`
- `docs/repo-release-design.md`

这些文档只描述当前方案、边界、流程和验收方式。不要保留已经废弃的探索过程，避免后续开发被旧思路误导。

## 安装

当前 fork 的实验性版本通过 GitHub Release 包安装：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
```

Release 资产固定命名为 `fba-cli.tgz`，因此安装命令不需要写具体版本号。发布流程见 `docs/repo-release-design.md`。

该 Release 包由 `repo-v*` tag 触发的 GitHub Actions 构建，发布前会运行测试、类型检查和构建检查。
