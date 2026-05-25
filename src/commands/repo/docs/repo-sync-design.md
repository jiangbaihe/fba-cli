# repo sync 设计摘要

## 目标

`fba-cli repo sync` 是日常同步向导。它同步主仓和用户自己的 `origin`，同步后端/前端和用户自己的 `origin`，并可选跟随官方 FBA `upstream`。它永远不 push。

## 关键规则

- 必须先确认目标项目，再 fetch 或修改仓库。
- 子仓目录名来自 `.fba.json`，必须是简单目录名；sync 不处理需要 Git quoted path 解析的目录名。
- 发现运行期 GitHub token 时，GitHub HTTPS fetch 使用临时 Git extraheader；不写入 remote URL、本地配置、日志或错误输出。
- origin 顺序：`main`、`backend`、`frontend`。
- upstream 只作用于 `backend`、`frontend`；主仓没有官方 upstream。
- 正式检查子仓前，先单独检查主仓本地状态和 `origin`。主仓本地状态阻断时，不能继续 fetch 子仓；如果主仓可 fast-forward，先询问用户是否处理；主仓更新成功后重新读取 `.fba.json`、`.gitmodules` 并重建同步计划。主仓 `diverged` 的 merge/rebase 必须等完整项目检查通过后再进入正常 origin 阶段，避免子仓或 `.gitmodules` 已有问题时先修改主仓。
- 如果启动时主仓已有的未提交改动只是真实子仓 gitlink 指针变化，先询问是否创建本地主仓提交；用户拒绝或无法确认时停止同步。
- 每个仓库同步前必须是 Git 根目录、有当前分支、有 `origin`、非浅克隆、工作区干净。
- 主仓预刷新造成的临时子模块指针变化不阻断子仓 origin 同步；无关主仓改动仍阻断。
- origin 状态动作：
  - `up-to-date`：跳过
  - `fast-forward`：推荐 `merge --ff-only`
  - `ahead`：保留本地提交，稍后 `repo push`
  - `diverged`：用户选择 rebase 或 merge；若本地提交已存在于 origin 任一远程分支，默认推荐 merge
  - `missing-remote-branch`：保留本地，稍后 `repo push`
- upstream `ahead` 表示官方没有新提交，自动跳过，不显示 merge/rebase；官方 upstream fetch 失败计为失败，upstream 不匹配计为跳过，二者都必须在摘要中体现。
- upstream `diverged` 也要结合 origin 状态判断默认策略：未发布本地提交可推荐 rebase，已发布本地提交默认推荐 merge。
- merge/rebase 冲突时让用户选择保留本地、使用传入、手动解决或中止；用户取消冲突菜单或自动选择一侧后仍有冲突时，必须打印 `status`、`continue`、`abort` 手动恢复命令并停止后续同步。
- 子仓移动后，主仓若只有真实 gitlink 指针变化，询问是否创建本地提交：

```bash
git add <backend_name> <frontend_name>
git commit -m "chore: sync repository pointers"
```

- 判断真实指针变化必须使用 `git diff --quiet --ignore-submodules=dirty -- <child_path>`，不能只看 `git status --porcelain`，以免 dirty-only 子仓工作区被误判。
- 不自动 stash、不 force、不 hard reset、不删除用户提交。

## 验收重点

- 主仓本地状态已阻断时，不能先 fetch 子仓。
- 主仓 origin fast-forward 可先行，主仓更新后重建子仓计划；主仓 merge/rebase 不得发生在完整项目检查之前。
- 官方 upstream fetch 失败时摘要必须体现失败；upstream 不匹配时摘要必须体现跳过，不能显示成无事发生。
- upstream `ahead` 不提示 merge/rebase。
- 已发布本地提交的 diverged 场景默认推荐 merge。
- dirty-only 子仓工作区不触发主仓指针提交。
- 冲突处理的本地/传入语义对 merge 和 rebase 都正确。
- 冲突菜单取消或连续 rebase 冲突时，必须给出手动恢复命令。
- 取消 upstream 分支选择必须中止本次 upstream 同步，不能当作普通跳过。
