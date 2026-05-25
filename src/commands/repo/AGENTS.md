# Repo 实验性功能维护指引

本目录只维护实验性的 `fba-cli repo` 仓库管理功能，用于协调主仓、后端子仓、前端子仓，以及 `origin` / `upstream` 远程关系。不要把这里的规则扩散到根目录文档或稳定公共模块。

## 边界

- `src/commands/repo/*.ts` 只做命令入口。
- 具体实现放在 `src/commands/repo/internal/`。
- 设计文档放在 `src/commands/repo/docs/`，且全部使用中文。
- 可以复用无需修改的公共能力；若 repo 需要特殊行为，在 `internal/` 内实现。
- `create.ts` 只能通过 `./repo/internal/create-integration` 接入 repo 功能。
- 唯一允许的根目录例外是 `.github/workflows/repo-release.yml`；不要改写原项目 `.github/workflows/release.yml` 的 npm 发布语义。

## 必守原则

- 沿用 fba-cli 的多项目和当前项目机制：`-p`、当前目录向上查找 `.fba.json`、全局当前项目。
- 目标项目必须有真实 `.fba.json`，且包含 `name`、`backend_name`、`frontend_name`。
- `.fba.json` 的 `name`、`backend_name`、`frontend_name` 读取后要去除首尾空白。
- `.fba.json` 的 `backend_name`、`frontend_name` 必须是不同的普通目录名，不能是绝对路径、`..`、带斜杠、空白或引号的路径。
- GitHub 远程只接受干净的 `https://github.com/<owner>/<repo>.git` 或无 `.git` 后缀形式，不接受 query、hash、内嵌账号密码或非法 owner/repo 片段。
- 任何网络请求、fetch、GitHub API 调用或本地修改前，必须展示解析出的项目并让用户确认。
- 所有关键分支都用向导交互；prompt 必须有默认值，直接回车必须正确应用默认值。
- 不自动 stash、不 force push、不 hard reset、不删除用户提交、不静默选择冲突一侧。
- 主仓没有官方 upstream；后端/前端的 upstream 才指向官方 FBA 仓库。
- `.gitmodules` 的子模块 URL 指向用户自己的子仓 `origin`，不是官方 upstream。
- GitHub token 只在运行时使用，不能写入 remote URL、日志、错误输出或配置文件。

## 命令契约

`repo init`：

- 初始化或修复本地维护配置。
- 新设备只克隆主仓后，可初始化缺失或未初始化的后端/前端子仓。
- 默认远程优先级：已有主仓 `origin`、子仓 `origin`、`.gitmodules` URL、生成值。
- 检查或创建 GitHub 主仓、后端仓、前端仓；创建可见性默认 public。
- 修正 `origin` / `upstream`、写入 `.gitmodules`、把浅克隆子仓转完整历史。
- 可修复后端/前端 detached HEAD：只在当前子模块提交上创建本地分支，不得跳到 `origin/<branch>` 最新提交；若同名本地分支已存在，使用不冲突的 `fba-repo-<branch>` 分支名；主仓 detached HEAD 只提示，不作为 init 可修复项。
- 出错时尽量回滚本地 remotes、`.gitmodules`、本轮创建的子仓目录和 `.git/modules/<child>`。
- 创建快照后，如果流程取消或失败且尚未完成最终应用，必须恢复本地快照。
- 缺失或未初始化子仓只能在用户确认远程计划和最终应用后修复；修复前要先把 `.gitmodules` 写成确认后的用户子仓 `origin` URL，避免旧 `.gitmodules` 克隆错仓。
- 缺失或未初始化子仓只能在主仓已经是 Git 根目录时修复；非空非 Git 子仓目录不能自动修复，必须提示用户手动处理。
- 不执行 push。

`repo status`：

- 只读检查；不 fetch、不 push、不创建仓库、不修改文件。
- 只对 `repo init` 确实能修复的问题建议运行 `repo init`；缺失子仓必须有可用 `.gitmodules` entry/path 且主仓是 Git 根目录，非空非 Git 子仓目录不能误导用户运行 init。

`repo sync`：

- 顺序：主仓 `origin`，后端/前端 `origin`，再询问是否跟随官方 `upstream`。
- 主仓从 `origin` 更新后必须重建子仓同步计划。
- 启动时如果主仓只存在真实子仓 gitlink 指针变更，要先走向导询问是否创建本地主仓提交；用户拒绝或无法确认时停止同步。
- 主仓本地状态已阻断时，不能继续 fetch 子仓。
- upstream 只作用于后端和前端；upstream `ahead` 自动跳过，不提示 merge/rebase。
- 取消 upstream 分支选择必须按取消处理并停止 upstream 同步，不能当成普通跳过。
- diverged 时必须基于真实 origin 状态推荐 rebase 或 merge；若本地提交已存在于 origin 任一远程分支，默认推荐 merge。
- 子仓移动后，如主仓只有真实 gitlink 指针变化，询问是否创建本地主仓提交。
- 判断指针变化必须排除 dirty-only 子仓工作区，不能只看 `git status --porcelain`。
- 不 push、不自动 stash、不 force。
- 冲突菜单取消或自动处理后仍需手动介入时，必须打印 `status`、`continue`、`abort` 恢复命令。

`repo push`：

- 唯一允许执行 `git push` 的 repo 子命令。
- 用户选择本次推送目标；未选仓库的脏工作区、浅克隆或 detached 状态不得阻断选中仓库。
- 顺序：后端、前端、主仓。
- 推送前对选中仓库执行 dry-run，真实 push 前再次确认。
- 主仓只有真实子仓指针变化时，可询问是否创建本地主仓指针提交。
- 如果指针提交会指向后端/前端新提交，本次推送必须同时选择对应子仓；否则只能跳过指针提交。
- 推送主仓时，未选子仓的 gitlink 提交必须已在对应 `origin` 上；已选子仓的 `HEAD` 必须包含主仓引用的 gitlink 提交；无法确认时按不安全处理并阻断。
- 检查主仓待推 gitlink 前必须先刷新主仓 `origin`；检查未选子仓 gitlink 是否已在 `origin` 上之前，也必须先刷新该子仓 `origin`；刷新失败按无法确认处理。
- 不自动提交业务改动、pull、merge、rebase、推送 tag 或 force push。

## 文档和测试

行为变化必须同步相关 Markdown：

- `README.md`：用户可见行为。
- `docs/repo-init-design.md`：init 或 create 集成。
- `docs/repo-sync-design.md`：sync、upstream、冲突、指针提交。
- `docs/repo-push-design.md`：push、推送顺序、指针安全。
- `docs/repo-release-design.md`：Release 安装、发布产物、`dist/` 策略。

常用验证：

```bash
bun test --isolate
pnpm run typecheck
git diff --check
```

发布包相关变化再运行：

```bash
pnpm run build
npm pack --dry-run --json
```

当前 fork 通过固定 GitHub Release 包安装，不提交 `dist/` 或 `.tgz`。实验性版本只使用 `repo-latest` tag/Release，不使用原项目 `v*` tag，也不维护多个实验版本 Release。

## 提交前

- 根目录没有新增 `AGENTS.md`。
- 根 `CLAUDE.md`、`README.md`、`README_en.md` 没有 repo 实验性长说明。
- 除 `.github/workflows/repo-release.yml` 外，没有为 repo 发布新增根目录基础设施。
- 原项目 `.github/workflows/release.yml` 仍保持原 npm 发布流程。
- 公共模块没有因为 repo 需求被改出新行为。
- repo 命令入口仍是薄入口。
- 文档、测试和当前行为一致。
