# Repo 实验性功能维护指引

本目录维护实验性的 `fba-cli repo` 仓库管理功能。它用于处理一个 FBA 项目的主仓、后端子仓、前端子仓，以及各自 `origin` / `upstream` 远程之间的关系。

这份文件只约束 `src/commands/repo/` 内的工作。不要把这里的实验性规则扩散到根目录 `AGENTS.md`、`CLAUDE.md`、根 README 或稳定公共模块。

唯一允许的根目录例外是 `.github/workflows/repo-release.yml`。它是本 fork 实验性 Release 包发布入口，不得承载 repo 运行时代码或业务逻辑，也不得改写原项目已有 `.github/workflows/release.yml` 的 npm 发布语义。

## 开始前先读

修改 repo 功能前，按需阅读：

1. `README.md`：了解 repo 功能对用户暴露的整体行为。
2. `docs/repo-init-design.md`：修改 `repo init` 或 create 集成时阅读。
3. `docs/repo-sync-design.md`：修改 `repo sync`、upstream 跟随、冲突处理或子模块指针逻辑时阅读。
4. `docs/repo-push-design.md`：修改 `repo push`、发布顺序或 Git 安装打包规则时阅读。
5. `docs/repo-release-design.md`：修改发布包、GitHub Release、安装命令或 `dist/` 策略时阅读。
6. `tests/repo-boundary.test.ts`：修改目录结构、公共 helper 复用方式或入口文件时阅读。

设计文档只描述当前方案、边界和验收方式。不要把已经废弃的探索过程写回文档。

## 目录边界

必须保持以下结构：

- `src/commands/repo/*.ts` 只做命令入口，导出对应 action 和 options 类型。
- `src/commands/repo/internal/*-runtime.ts` 负责向导流程编排。
- `src/commands/repo/internal/*-inspection.ts` 负责读取本地状态。
- `src/commands/repo/internal/*-operations.ts` 负责有副作用的 Git 或文件操作。
- `src/commands/repo/internal/*-prompts.ts` 负责可复用交互。
- `src/commands/repo/internal/register.ts` 负责把 `repo` 命令挂载到根 CLI，根 `src/index.ts` 不应直接依赖 repo action 或 repo 文案 helper。
- `src/commands/repo/internal/*.ts` 中的纯规划 helper 要尽量保持可单测。
- `src/commands/repo/docs/*.md` 存放 repo 设计文档。

可以直接复用原项目公共能力，但前提是无需修改公共模块行为。如果 repo 需要不同能力，请在 `internal/` 内实现独立版本。例如 repo 已有自己的 `internal/git.ts` 和 `internal/process.ts`，不要为了 repo 改 `src/lib/git.ts` 或 `src/lib/process.ts`。

`create.ts` 只允许通过 `./repo/internal/create-integration` 接入 repo 功能，不要让 create 直接依赖 repo 的 GitHub、Git、事务或运行时细节。

## 项目选择原则

所有 repo 子命令必须沿用 fba-cli 的多项目和当前项目机制：

1. 显式全局参数 `-p, --project <dir>`
2. 从当前工作目录向上查找最近的 `.fba.json`
3. 全局配置 `~/.fba.json` 中的当前项目

命令必须在任何网络请求、fetch、GitHub API 调用或本地修改前展示解析出的项目，并让用户确认。

目标项目必须包含真实 `.fba.json`，且至少有：

- `name`
- `backend_name`
- `frontend_name`

不要为 repo 命令引入绕过 `.fba.json` 的备用传参、backup 目录扫描或硬编码项目名。

## 交互原则

repo 功能必须是向导式交互：

- 所有关键分支由用户决定。
- 每个 prompt 都要提供合理默认值。
- 用户直接回车时必须正确应用默认值。
- 相同类型的交互在各子命令中保持一致，包括项目确认、取消、错误提示、回滚提示和下一步建议。
- 提示文案要解释“为什么现在要用户选择”，不要只展示底层 enum 或 Git 状态。

高风险分支必须显式询问：

- 创建或复用远程仓库
- 仓库可见性 public/private
- fast-forward、merge、rebase、skip、cancel
- 冲突时保留本地、使用传入改动、手动解决或中止
- 子仓更新导致主仓子模块指针变化时是否创建本地提交
- 真实 push 前的最终确认

## 命令契约

`repo init`：

- 初始化本地维护配置。
- 检查或创建 GitHub 主仓、后端仓、前端仓。
- 修正本地 `origin` / `upstream`。
- 写入主仓 `.gitmodules`。
- 自动把浅克隆子仓转成完整历史。
- 出错时尽量回滚到 `repo init` 前的本地状态。
- 不执行 `git push`。

`repo status`：

- 只读检查。
- 不 fetch、不 push、不创建远程仓库、不修改文件。
- 检查主仓、子仓、remote、浅克隆、工作区和 `.gitmodules`。

`repo sync`：

- 先同步主仓 `origin`，再同步后端和前端 `origin`，最后询问是否跟随官方 `upstream`。
- 主仓从 `origin` 更新后，必须重新构建子仓同步计划。
- `upstream` 只作用于后端和前端。
- upstream `ahead` 表示官方 upstream 没有新提交，应自动跳过，不得提示 merge/rebase。
- 子仓移动后，如果主仓只出现子模块指针变化，询问是否创建本地指针提交。
- 不 push、不自动 stash、不 force。

`repo push`：

- 唯一允许执行 `git push` 的 repo 子命令。
- 只发布用户已经整理干净的提交。
- 推送顺序为后端、前端、主仓。
- 真实 push 前必须对所有仓库 dry-run。
- dry-run 通过后仍必须二次确认。
- 不自动 stage、commit、pull、merge、rebase、推送 tag 或 force push。

## Git 与远程规则

主仓、后端、前端的关系必须始终清晰：

- 主仓 `origin` 指向用户自己的主项目仓库。
- 后端 `origin` 指向用户自己的后端仓库。
- 前端 `origin` 指向用户自己的前端仓库。
- 后端 `upstream` 指向官方 FBA 后端仓库。
- 前端 `upstream` 指向官方 FBA 前端仓库。
- 主仓没有官方 FBA upstream。
- `.gitmodules` 中的子模块 URL 指向用户自己的子仓 `origin`，不是官方 upstream。

不要把 GitHub token 写入 remote URL、日志、错误输出或配置文件。token 只在运行时使用。

## 禁止事项

除非用户明确提出并重新设计，否则不要做这些事：

- 不要在 `repo init`、`repo status`、`repo sync` 中 push。
- 不要自动 stash/pop。
- 不要 force push。
- 不要静默 hard reset。
- 不要静默选择冲突一侧。
- 不要删除用户提交。
- 不要让主仓跟随官方 FBA upstream。
- 不要把 repo 规则写进根目录文档。
- 不要为了 repo 改稳定公共 helper 的行为。
- 不要在测试中访问真实 GitHub 或真实远程仓库。

## 测试要求

修改 repo 功能时优先补测试。重点覆盖：

- 多项目和当前项目兼容性
- 用户确认前无网络请求和本地副作用
- prompt 默认值直接回车生效
- 主仓、后端、前端的执行顺序
- `origin` / `upstream` 关系
- `.gitmodules` 与子仓 `origin` 一致性
- 浅克隆检测和 unshallow 行为
- init 回滚
- sync 的 upstream `ahead`、diverged、冲突处理和子模块指针提交
- push 的 dry-run、最终确认和失败停止
- repo 模块边界

常用测试：

```bash
bun test tests/repo-boundary.test.ts
bun test tests/repo-init-command.test.ts tests/repo-init-operations.test.ts tests/repo-init-plan.test.ts
bun test tests/repo-sync-command.test.ts tests/repo-sync.test.ts
bun test tests/repo-push-command.test.ts tests/repo-push.test.ts
bun test tests/repo-status-command.test.ts tests/repo-status.test.ts
```

完整验证：

```bash
bun test
bunx tsc --noEmit
git diff --check
```

如果影响发布包、安装命令或 `dist/`：

```bash
pnpm run build
npm pack --dry-run --json
```

确认 `npm pack --dry-run --json` 输出包含 `dist/index.js`。

当前 fork 使用 GitHub Release 包安装，不通过提交 `dist/` 安装。发布资产固定命名为 `fba-cli.tgz`，用户安装命令固定为：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
```

不要把 `dist/` 或 `*.tgz` 作为 repo 功能改动的一部分提交。发布流程和安装验收见 `docs/repo-release-design.md`。

Release 由 `repo-v*` tag push 触发 `.github/workflows/repo-release.yml` 自动发布。该 workflow 必须在打包前运行测试、类型检查、空白检查和构建。不要把本地脚本、手动网页上传或 GitHub CLI 上传写成主发布路径。

不要为实验性版本推送 `v*` tag。`v*` tag 属于原项目 `.github/workflows/release.yml` 的 npm 发布流程；fork 中误推可能触发失败 workflow。实验性版本只使用 `repo-v*` tag。

发布、测试和构建优先沿用源项目既有脚本、工具链和 GitHub Actions 结构。repo 实验性 Release workflow 可以安装测试所需工具，但不得为了自身需求改写根项目工具链或原项目发布 workflow。

## 文档维护

本目录内 Markdown 使用中文。命令、路径、Git 术语、API 路径和提交信息可以保留英文。

行为变化必须同步更新：

- `README.md`：用户可见行为变化。
- `docs/repo-init-design.md`：init 或 create 集成变化。
- `docs/repo-sync-design.md`：sync、upstream、冲突或指针提交变化。
- `docs/repo-push-design.md`：push、发布顺序或打包规则变化。
- `docs/repo-release-design.md`：Release 安装、发布产物或 `dist/` 策略变化。
- 本文件：维护边界、禁止事项或验证流程变化。

文档要描述最终方案，不要记录“曾经试过但废弃”的过程。

## 提交前检查

在准备提交或请求 review 前确认：

- 根目录没有新增 `AGENTS.md`。
- 根 `CLAUDE.md`、`README.md`、`README_en.md` 没有写入 repo 实验性长说明。
- 除 `.github/workflows/repo-release.yml` 外，没有因为 repo 发布需求新增根目录基础设施文件。
- 原项目 `.github/workflows/release.yml` 仍保留原有 npm 发布流程。
- repo 发布文档明确提醒实验性版本只使用 `repo-v*` tag，不使用原项目 `v*` tag。
- `src/lib/git.ts`、`src/lib/process.ts` 等公共模块没有因为 repo 需求被改出新行为。
- repo 命令入口仍然是薄入口。
- 设计文档和测试与当前行为一致。
- 如果不在发布步骤中，不要把 `dist/` 或 `.tgz` 放进提交。
- 工作区没有无意生成的临时文件或包文件。
