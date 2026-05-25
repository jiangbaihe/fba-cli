# repo push 设计摘要

## 目标

`fba-cli repo push` 是唯一允许推送的 repo 子命令。它只发布用户已经整理好的提交，不自动 pull、merge、rebase、业务 commit、tag push 或 force push。

## 关键规则

- 必须先确认目标项目，再做 dry-run 或真实 push。
- 子仓目录名来自 `.fba.json`，必须是简单目录名；push 不处理需要 Git quoted path 解析的目录名。
- 用户选择本次推送目标；可只推主仓、只推子仓或任意组合。
- 发现运行期 GitHub token 时，GitHub HTTPS fetch、dry-run push 和 push 使用临时 Git extraheader；不写入 remote URL、本地配置、日志或错误输出。
- 只有可识别的 Git 根目录、有当前分支、有 `origin` 的仓库会出现在可选目标中。
- 只对选中仓库执行硬性前置检查；选中仓库必须不是浅克隆，包含选中的主仓；未选仓库的脏工作区、浅克隆、detached 状态不阻断。
- 推送顺序固定：`backend`、`frontend`、`main`。
- 真实 push 前先对选中仓库执行：

```bash
git push --dry-run --no-follow-tags origin HEAD:<branch>
```

- dry-run 全部通过后，仍需二次确认；真实 push 使用 `git push --no-follow-tags -u origin HEAD:<branch>`，在第一个失败处停止，且不受用户全局 `push.followTags` 配置影响。
- 主仓只有真实子仓 gitlink 指针变化时，可询问是否创建本地主仓提交：

```bash
git add <backend_name> <frontend_name>
git commit -m "chore: update submodule refs"
```

- 判断真实指针变化必须使用 `git diff --quiet --ignore-submodules=dirty -- <child_path>`；dirty-only 子仓工作区不能触发主仓指针提交。
- 如果当前工作区指针提交会指向后端/前端新提交，本次推送必须同时选择对应子仓；若未选择对应子仓，但该子仓当前 `HEAD` 已经在刷新后的 `origin` 上，可以创建主仓指针提交；否则自动跳过指针提交，继续推送已有主仓提交。
- 推送主仓已有提交时，必须先刷新主仓 `origin`，再检查 `origin/<branch>..HEAD` 中所有待推主仓提交的子仓 gitlink。未选子仓会先 `git fetch origin --prune`；未选子仓的每个 gitlink 提交必须已在刷新后的 `origin` 上；已选子仓的当前 `HEAD` 必须包含每个 gitlink 提交；无法确认时阻断。
- 用户拒绝指针提交，或本次未选择受影响子仓导致自动跳过指针提交后，可以继续推送主仓已有提交。
- 主仓存在普通未提交改动时阻断，不得混入自动指针提交。

## 验收重点

- dirty-only 子仓工作区不触发主仓指针提交。
- 创建主仓指针提交时，未选子仓必须确认当前 `HEAD` 已在 `origin` 上；否则不提示创建，直接跳过自动指针提交。
- 主仓待推历史不能引用未推送、未包含在已选子仓 `HEAD` 中或无法确认的子仓提交；主仓 `origin` 或未选子仓 `origin` 刷新失败时按无法确认处理。
- dry-run 失败不会真实 push。
- 真实 push 失败后展示已推送、失败、未推送仓库。
