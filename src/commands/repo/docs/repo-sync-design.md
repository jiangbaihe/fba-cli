# 实验性仓库同步设计

## 目标

`fba-cli repo sync` 是实验性仓库维护流程中的日常同步向导。

它帮助开发者：

- 同步主仓和用户自己的 `origin`
- 同步后端、前端子仓和用户自己的 `origin`
- 可选跟随官方 FBA `upstream` 更新后端和前端
- 选择如何处理非 fast-forward 历史
- 出现冲突时安全地解决或停止

`repo sync` 永远不 push。发布仍由 `fba-cli repo push` 负责。

## 边界

`repo sync` 是交互式 Git 工作流助手，不是静默自动修复器。

实现收在 repo 模块内：

```text
src/commands/repo/sync.ts
src/commands/repo/internal/sync-runtime.ts
src/commands/repo/internal/sync-inspection.ts
src/commands/repo/internal/sync-operations.ts
src/commands/repo/internal/sync-conflicts.ts
src/commands/repo/internal/sync-prompts.ts
src/commands/repo/internal/sync.ts
src/commands/repo/internal/git.ts
```

顶层命令文件只做薄入口。运行时编排、检查、提示格式化、冲突行为、Git 操作和纯规划 helper 都放在 `src/commands/repo/internal/`。

## 项目解析

命令沿用 fba-cli 现有项目解析规则：

1. 显式全局参数 `-p, --project <dir>`
2. 从当前工作目录向上查找最近的 `.fba.json`
3. 全局配置 `~/.fba.json` 中的当前项目

目标项目必须包含真实的 `.fba.json`，并包含：

- `name`
- `backend_name`
- `frontend_name`

在 fetch 或其他网络 Git 操作前，向导会展示解析出的项目，并要求用户确认。

## 同步顺序

`origin` 同步顺序：

1. main
2. backend
3. frontend

`upstream` 同步顺序：

1. backend
2. frontend

主仓先跟随 `origin`，这样另一台设备创建的元数据和子模块指针可以先到达本地，再决定如何移动子仓。

本工作流中，主仓没有官方 FBA upstream。

在检查子仓前，命令会先单独检查主仓 `origin`。如果主仓存在来自 `origin` 的传入更新，向导先让用户决定是否处理主仓。主仓更新成功后，命令会重新读取 `.fba.json`，并重新构建完整同步计划，再决定如何处理后端和前端。这样 `.fba.json`、`.gitmodules`、子目录名和 remote 比较都会基于最新主仓状态。

如果用户在这个预刷新步骤选择跳过主仓，命令会继续使用当前本地 `.fba.json`、`.gitmodules` 和子仓目录构建计划，并在正式 `origin` 阶段跳过主仓，只处理后端和前端。

## 前置条件

每个仓库都必须满足：

- 目录存在
- 目录是 Git 仓库根目录
- 当前分支不是 detached HEAD
- 已配置 `origin` remote
- 仓库不是浅克隆
- 工作区干净

后端和前端还应满足：

- `upstream` 指向官方 FBA 仓库

主仓还应满足：

- `.gitmodules` 存在
- 后端/前端 `.gitmodules` URL 与子仓 `origin` URL 一致

脏工作区会阻止同步。命令不会自动 stash/pop，因为三仓冲突需要保持显式、可预期。

如果本地 `.fba.json`、`.gitmodules` 或子仓目录名已经落后于另一台设备提交到主仓 `origin` 的配置，子仓检查不得先阻断主仓更新。主仓预刷新成功后，必须重新构建计划，再执行完整前置检查。

主仓正常 fast-forward 后，Git 可能会暂时显示后端/前端子模块指针变化。这些仅由指针造成的变化不会阻止子仓 `origin` 同步。无关的主仓改动仍会停止流程。

## origin 同步

对每个仓库，命令会：

1. 执行 `git fetch origin --prune`
2. 比较 `HEAD` 与 `origin/<current-branch>`
3. 需要动作时询问用户如何处理

状态：

- `up-to-date`：无需处理
- `fast-forward`：推荐 fast-forward
- `ahead`：本地提交尚不在 origin 上，推荐稍后 `repo push` 或跳过
- `diverged`：本地和 origin 都有独有提交，推荐 rebase；如果本地提交已经发布过则更谨慎
- `missing-remote-branch`：推荐 `repo push` 或跳过
- `unknown`：停止该仓库并说明原因

支持动作：

- 从 `origin/<branch>` fast-forward
- rebase 到 `origin/<branch>`
- merge `origin/<branch>`
- skip
- cancel

fast-forward 使用：

```bash
git merge --ff-only origin/<branch>
```

rebase 使用：

```bash
git rebase origin/<branch>
```

merge 使用：

```bash
git merge origin/<branch>
```

## upstream 同步

origin 同步结束后，向导询问是否跟随官方 upstream 更新。

只有后端和前端参与。对每个子仓，命令会：

1. 校验 `upstream`
2. 执行 `git fetch upstream --prune`
3. 选择 upstream 目标分支
4. 比较 `HEAD` 与 `upstream/<branch>`
5. 存在更新时询问如何处理

默认 upstream 分支是当前本地分支，如果该分支存在于 `upstream`。如果不存在，向导提供已知 upstream 分支供选择。

upstream 状态处理：

- `up-to-date`：无需处理
- `fast-forward`：官方 upstream 有新提交，本地没有独有提交，推荐 fast-forward
- `ahead`：本地项目提交存在，但官方 upstream 没有新提交，自动跳过并提示信息
- `diverged`：本地项目提交和官方 upstream 都有独有提交，询问 rebase 或 merge
- `missing-remote-branch`：提供 upstream 分支选择
- `unknown`：停止该仓库并说明原因

支持动作：

- 从 `upstream/<branch>` fast-forward
- rebase 到 `upstream/<branch>`
- merge `upstream/<branch>`
- 选择另一个 upstream 分支
- skip
- cancel

如果本地提交看起来已经推送到用户自己的 `origin`，向导会在 rebase 前警告用户。对已经发布过的本地历史，推荐 merge。

rebase 警告只在官方 upstream 有传入提交时才有意义。`ahead` 状态没有来自 upstream 的新内容，因此不得出现 merge/rebase 提示。

## 冲突处理

如果 merge 或 rebase 产生冲突，向导会：

1. 读取冲突路径
2. 展示冲突路径
3. 询问用户如何继续

选项：

- 保留当前本地项目改动
- 使用传入的 origin/upstream 改动
- 暂停，手动解决
- 中止当前操作

merge 冲突可执行：

```bash
git checkout --ours <paths>
git add <paths>
git commit --no-edit
```

或：

```bash
git checkout --theirs <paths>
git add <paths>
git commit --no-edit
```

rebase 冲突中，Git 的 `ours` / `theirs` 容易让用户误解：

- `ours` 是正在被 replay 到的目标分支
- `theirs` 是正在 replay 的本地提交

因此 UI 使用用户能理解的标签，不直接暴露裸 `ours` / `theirs` 让用户猜。

手动解决会让仓库保持冲突状态，停止后续仓库，并打印恢复命令。

中止会执行：

```bash
git merge --abort
```

或：

```bash
git rebase --abort
```

如果中止失败，命令停止，并提示用户检查：

```bash
git status
```

## 子模块指针后续处理

后端或前端移动后，主仓可能显示子模块 gitlink 变化。

规则：

- 不要静默提交子模块指针更新
- 子仓同步后检查主仓工作区
- 如果只有子仓指针变化，询问是否创建本地主仓同步提交
- 如果存在无关主仓改动，停止并要求用户手动处理
- 永远不自动 push

本地指针提交使用：

```bash
git add <backend_name> <frontend_name>
git commit -m "chore: sync repository pointers"
```

如果用户拒绝，改动会留在工作区，供用户手动处理。

## 摘要

流程结束时，命令总结：

- 已应用的 origin 更新
- 已跳过的 origin 仓库
- 已应用的 upstream 更新
- 已跳过的 upstream 仓库
- 自动解决的冲突
- 留给用户手动处理的仓库
- 是否创建了主仓子模块指针提交

如果本地提交已经准备好发布，下一步命令是：

```bash
fba-cli repo push
```

发布和 Release 安装规则见 `repo-push-design.md`。

## 非目标

`repo sync` 不做以下事情：

- push
- 创建 GitHub 仓库
- 修改 remotes
- force push
- 静默 hard reset
- 自动 stash/pop 本地改动
- 删除用户提交
- 静默选择冲突一侧
- 让主仓跟随官方 FBA upstream

## 测试

测试不得使用真实远程。

覆盖重点：

- 确认项目发生在 fetch 前
- origin 顺序为 main、backend、frontend
- upstream 只作用于 backend 和 frontend
- fast-forward、rebase、merge、skip、cancel 规划
- upstream 分支选择
- upstream `ahead` 不出现 merge/rebase 提示
- rebase 已发布提交前给出警告
- `.fba.json`、`.gitmodules` 或子仓目录名过期时的主仓预刷新行为
- 主仓 `origin` 更新后重新构建子仓同步计划
- 临时的指针类主仓改动不阻止子仓 origin 同步
- merge 和 rebase 冲突侧映射
- 手动冲突解决会停止后续仓库
- abort 失败会停止流程
- 子仓更新可触发可选主仓指针提交
- 没有子仓移动时不提供指针提交

验证命令：

```bash
bun test
bunx tsc --noEmit
git diff --check
```
