# 实验性仓库初始化设计

## 目标

`fba-cli repo init` 用于初始化 FBA 项目的本地仓库维护配置。

该流程会准备三个仓库：

- 主项目仓库
- 后端子仓库
- 前端子仓库

同时配置预期的远程关系：

- 主仓 `origin` 指向用户自己的项目仓库
- 后端 `origin` 指向用户自己的后端仓库
- 前端 `origin` 指向用户自己的前端仓库
- 后端 `upstream` 指向官方 FBA 后端仓库
- 前端 `upstream` 指向官方 FBA 前端仓库

`repo init` 可以创建或复用 GitHub 仓库，但不会 push。发布由 `fba-cli repo push` 负责。

## 边界

`repo init` 属于实验性 `repo` 功能，相关实现收在 repo 命令模块内：

```text
src/commands/repo/init.ts
src/commands/repo/internal/init-runtime.ts
src/commands/repo/internal/init-operations.ts
src/commands/repo/internal/init-types.ts
src/commands/repo/internal/init.ts
src/commands/repo/internal/github.ts
src/commands/repo/internal/github-token.ts
src/commands/repo/internal/git.ts
src/commands/repo/internal/project.ts
src/commands/repo/internal/transaction.ts
```

顶层命令文件只做薄入口。运行时流程、规划 helper、GitHub helper、Git helper、项目配置解析和回滚逻辑都放在 `src/commands/repo/internal/`。

公共能力如果不需要修改可以直接复用；repo 维护特有的行为应放在 `repo/internal`，不要改动稳定公共模块。

## 项目解析

命令沿用 fba-cli 现有项目解析规则：

1. 显式全局参数 `-p, --project <dir>`
2. 从当前工作目录向上查找最近的 `.fba.json`
3. 全局配置 `~/.fba.json` 中的当前项目

目标项目必须包含真实的 `.fba.json`，严格配置必须包含：

- `name`
- `backend_name`
- `frontend_name`

在发起网络请求或修改本地状态前，向导会展示解析出的项目，并要求用户确认。

确认后、发现 GitHub token 前，命令会检查后端和前端目录是否都是 Git 仓库根目录。如果任一子目录不是 Git 根目录，流程会在 GitHub API 调用和本地 remote 修改前停止。

## create 集成

`fba-cli create` 保持默认快速路径：

- 后端默认浅克隆
- 前端默认浅克隆
- 除非用户启用实验性功能，否则跳过仓库维护问题

当用户在 `create` 过程中启用实验性仓库维护：

- 后端和前端使用完整历史克隆
- 正常项目创建先完成
- 随后向导询问是否运行 `repo init`

如果项目创建成功后 `repo init` 失败，`create` 会保留项目，并提示用户稍后重新运行：

```bash
fba-cli repo init
```

## GitHub 认证

向导按以下顺序发现 GitHub token：

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. 已登录 GitHub CLI 时的 `gh auth token`
4. 非交互模式下针对 `https://github.com` 的 `git credential fill`
5. 密码输入提示

token 不会持久化，也不能写入 Git remote URL、日志或错误输出。

找到 token 后，向导会调用 GitHub `/user`，并使用认证用户 login 作为默认 owner。

## 远程规划

默认远程 URL 为：

```text
main:     https://github.com/<owner>/<project_name>.git
backend:  https://github.com/<owner>/<backend_name>.git
frontend: https://github.com/<owner>/<frontend_name>.git
```

向导先询问是否使用全部默认值。如果用户选择否，可以逐个编辑 URL。

当前只支持 GitHub HTTPS URL：

```text
https://github.com/owner/repo.git
```

SSH URL 和非 GitHub 提供商暂不纳入范围。

每个输入都必须提供默认值，用户直接回车时应用默认值。

## 远程状态规划

对每个规划出的 GitHub 仓库：

- 如果仓库已存在，询问是否复用
- 如果仓库不存在，询问是否创建
- 如果要创建，询问可见性，默认 `public`
- 如果用户拒绝复用或创建，取消流程且不修改本地
- 如果 GitHub 查询因为认证、权限或 API 错误失败，停止并给出可操作提示

仓库创建接口：

- owner 是认证用户时使用 `POST /user/repos`
- owner 是组织时使用 `POST /orgs/{org}/repos`

owner 比较不区分大小写。

规划阶段不得创建远程仓库，也不得修改本地文件。

## 应用阶段

最终确认后，`repo init` 会：

1. 记录本地回滚快照
2. 必要时把后端/前端浅克隆转换为完整历史
3. 创建标记为需要创建的 GitHub 仓库
4. 确保后端 `origin`
5. 确保后端 `upstream`
6. 确保前端 `origin`
7. 确保前端 `upstream`
8. 必要时初始化主仓 Git 仓库
9. 确保主仓 `origin`
10. 写入或更新 `.gitmodules`
11. 可选创建主仓本地初始化提交

完整历史检查发生在 GitHub 仓库创建前。如果拉取完整子仓历史失败，不会创建新的 GitHub 仓库。

可选本地提交会执行：

```bash
git add .gitmodules <backend_name> <frontend_name>
git commit -m "chore: initialize repository remotes"
```

命令永远不执行 `git push`。

## 子模块策略

后端和前端目录在 `create` 后已经存在，所以 `repo init` 不依赖 `git submodule add`。

`repo init` 直接写入 `.gitmodules`：

```ini
[submodule "<backend_name>"]
	path = <backend_name>
	url = https://github.com/<owner>/<backend_repo>.git

[submodule "<frontend_name>"]
	path = <frontend_name>
	url = https://github.com/<owner>/<frontend_repo>.git
```

子模块 URL 指向用户自己的仓库。官方 FBA 仓库只体现在子仓的 `upstream` remote 中。

## 工作区规则

`repo init` 不要求后端和前端工作区完全干净，因为 `create` 可能会生成本地环境文件。

规则：

- 后端和前端可以有本地改动
- 子模块 gitlink 指向子仓 `HEAD`，不是未提交文件
- 主仓 `.gitmodules` 必须可以安全更新
- 自动本地提交不得混入无关主仓改动

## 回滚

回滚只处理本地状态。

快照记录：

- 主仓 `.git` 目录此前是否存在
- `.gitmodules` 原内容或不存在状态
- 主仓 `origin` 和 `upstream`
- 后端 `origin` 和 `upstream`
- 前端 `origin` 和 `upstream`

应用阶段开始后如果失败，`repo init` 会恢复本地 remotes 和 `.gitmodules`。如果流程创建了主仓 `.git` 目录，会移除该目录。它不会删除远程 GitHub 仓库，也不会撤销 `git fetch --unshallow`。

回滚后保留项目，并提示用户修复问题后重新运行：

```bash
fba-cli repo init
```

## 完成输出

成功后输出摘要：

- 创建了哪些仓库
- 复用了哪些仓库
- 更新了哪些本地 remotes
- 哪些浅克隆子仓被转换为完整历史
- 是否创建了本地初始化提交

建议后续检查：

```bash
fba-cli repo status
fba-cli repo push
```

发布和 Release 安装规则见 `repo-push-design.md`。

## 测试

测试不得使用真实 GitHub 或真实远程 push。

覆盖重点：

- 严格项目配置解析
- 默认远程规划
- GitHub HTTPS URL 解析
- owner 校验和 owner 大小写不敏感比较
- token 发现顺序
- 仓库查询和创建 API 形状
- 子仓 Git 根目录预检查必须早于 GitHub 访问
- `.gitmodules` 渲染和 upsert 行为
- 本地回滚行为
- 浅克隆检测和 unshallow 命令行为
- 创建 GitHub 仓库前先拉取完整历史
- 用户确认目标项目前，不访问 GitHub、不修改本地
- 从 `create` 调用时返回布尔结果

验证命令：

```bash
bun test
bunx tsc --noEmit
git diff --check
```
