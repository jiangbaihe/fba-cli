# 实验性仓库维护

`fba-cli repo` 用向导维护 FBA 项目的主仓、后端子仓、前端子仓，以及各自的 `origin` / `upstream`。

实现收在本目录：命令入口是 `*.ts`，具体逻辑在 `internal/`，设计摘要在 `docs/`。

## 命令

```bash
fba-cli repo init
```

初始化或修复本地仓库配置：子仓、remote、`.gitmodules`、浅克隆和子仓 detached HEAD。缺失或未初始化子仓只会在确认远程计划后，从已有子仓远程按主仓 gitlink 初始化；不 push。运行期 GitHub token 只走 API 和临时 Git 认证，不写入配置或日志。

```bash
fba-cli repo status
```

只读健康检查；不 fetch、不 push、不创建仓库、不修改文件。

```bash
fba-cli repo sync
```

向导式同步主仓、子仓 `origin`，并可选跟随后端/前端官方 `upstream`。主仓可先 fast-forward 以刷新项目元数据；merge/rebase 只在完整检查通过后按用户选择执行。支持冲突恢复提示；不 push、不 stash、不 force。

```bash
fba-cli repo push
```

向导式推送干净提交。用户选择目标，先 dry-run，再二次确认，按后端、前端、主仓顺序 push。推主仓前会检查待推 gitlink：未选子仓提交必须已在 `origin` 上，已选子仓 HEAD 必须包含主仓引用的提交；无法确认时阻断。不会推送 tag 或 force push。

## 新设备接入

子仓目录名来自 `.fba.json`，必须是简单目录名，不能包含空白、引号或路径分隔符；在 Windows/macOS 上大小写不同但指向同一路径的名称也会被拒绝。

```powershell
git clone https://github.com/<owner>/<project>.git
cd <project>
fba-cli repo init
fba-cli repo status
```

## 安装

当前 fork 的实验性版本通过固定 GitHub Release 包安装：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/download/repo-latest/fba-cli.tgz
```

Release 使用固定 tag `repo-latest` 和固定资产名 `fba-cli.tgz`。发布新实验包时覆盖同一个 Release，用户安装地址不变。发布规则见 `docs/repo-release-design.md`。

## 设计摘要

- `docs/repo-init-design.md`
- `docs/repo-sync-design.md`
- `docs/repo-push-design.md`
- `docs/repo-release-design.md`

文档只保留当前方案、边界和验收方式。
