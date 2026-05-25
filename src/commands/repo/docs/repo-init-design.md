# repo init 设计摘要

## 目标

`fba-cli repo init` 初始化或修复本地仓库维护配置。它处理主仓、后端子仓、前端子仓的 remote、`.gitmodules`、浅克隆和新设备缺失子仓问题。它可以创建或复用 GitHub 仓库，但不执行 push。

## 关键规则

- 必须先确认目标项目；目标项目必须有 `.fba.json`，且包含 `name`、`backend_name`、`frontend_name`。
- `.fba.json` 字段读取后要去除首尾空白；前后端目录名必须不同，且必须是普通目录名，不能越出项目目录，也不能包含空白、引号或路径分隔符；Windows/macOS 上大小写不同但指向同一路径的名称也要按重复处理。
- GitHub token 发现顺序：`GITHUB_TOKEN`、`GH_TOKEN`、`gh auth token`、`git credential fill`、密码输入。运行期 token 用于 GitHub API，也会通过临时 Git extraheader 供 GitHub HTTPS `fetch` / `submodule update` 使用；不得写入 remote URL、日志、错误输出或配置文件。
- 新设备只克隆主仓后，如后端/前端目录缺失或不是 Git 根目录，先确认 GitHub owner、远程 URL 和远程仓库复用计划；对应子仓远程必须已存在，不能在本轮新建空仓库后再初始化子仓。最终应用确认后，把 `.gitmodules` 写成确认后的子仓 `origin` URL，并询问是否执行：

```bash
git submodule sync -- <backend_name> <frontend_name>
git submodule update --init --checkout -- <backend_name> <frontend_name>
```

- 远程默认值优先级：已有主仓 `origin`、已有子仓 `origin`、`.gitmodules` URL、根据 owner 和 `.fba.json` 生成的 GitHub HTTPS URL。
- GitHub URL 只接受干净的 `https://github.com/<owner>/<repo>.git` 或无 `.git` 后缀形式，不接受 query、hash、内嵌账号密码或非法 owner/repo 片段。
- 主仓、后端、前端远程必须指向不同 GitHub 仓库，避免主仓把自身作为子模块或多个角色共用同一远程。
- 远程仓存在则询问是否复用；不存在则询问是否创建；创建可见性默认 public。若缺失或未初始化子仓对应的远程仓不存在，应在询问创建可见性和最终应用前停止。
- 缺失或已存在但不是 Git 根目录的子仓只能从已存在且包含主仓 gitlink 所需提交的子仓远程初始化；执行 `submodule update` 前必须确认主仓当前 `HEAD` 对这些子仓路径存在 `160000 commit` gitlink。若主仓没有记录对应 gitlink，或对应子仓远程计划为本轮新建的空 GitHub 仓库，`repo init` 应停止并提示用户先切到包含子模块指针的主仓提交、提供已有子仓远程，或先手动添加子模块。
- 缺失或未初始化子仓只能在主仓已经是 Git 根目录时通过 `git submodule update --init --checkout` 修复；已存在且非空、但不是 Git 根目录的子仓目录不能自动修复，必须提示用户手动备份、移走或整理为 Git 仓库。
- 后端/前端 `origin` 指向用户仓库，`upstream` 指向官方 FBA 仓库；主仓只配置用户自己的 `origin`。
- 子仓浅克隆要在创建 GitHub 仓库前转完整历史；如果子仓已有 `origin`，先从现有 `origin` 补全历史，再改到确认后的用户子仓；如果子仓缺少 `origin` 且计划复用已有远程，先设置该远程再补全历史。子仓 detached HEAD 只在当前子模块提交上创建本地分支，不跳到 `origin/<branch>` 最新提交；若同名本地分支已存在，使用 `fba-repo-<branch>` 等不冲突分支名；主仓 detached HEAD 只提示，不作为 `repo init` 可修复项。
- 直接写入或更新 `.gitmodules`，URL 指向用户自己的子仓 `origin`。
- 更新 `.gitmodules` 时按 section name 或 `path` 替换旧的后端/前端段，避免 section name 变化后产生重复子模块 path。
- 可选创建本地主仓初始化提交：

```bash
git add .gitmodules <backend_name> <frontend_name>
git commit -m "chore: initialize repository remotes"
```

- 若主仓处于 detached HEAD，跳过本地初始化提交提示，要求用户先切换到分支后手动提交。
- 若 `.gitmodules`、后端目录或前端目录已有 staged 内容，跳过本地初始化提交，避免把用户已暂存内容混入自动提交或在失败时取消暂存。
- 回滚只处理本地状态：remotes、`.gitmodules`、本轮创建的主仓 `.git`、本轮创建的子仓目录、本轮创建的 submodule metadata、本轮为 detached 子仓修复创建的本地分支。创建快照后，如后续取消或失败且尚未完成最终应用，恢复本地快照；不删除远程 GitHub 仓库，不撤销 `fetch --unshallow`，不清空用户原本存在且非空的非 Git 子目录。

## create 集成

`fba-cli create` 只通过 `repo/internal/create-integration` 接入实验性 repo 功能。用户选择启用远程仓库维护后，后端/前端克隆使用完整历史；项目创建完成并注册后，再询问是否立即运行 `repo init`。`repo init` 失败只提示用户稍后手动运行，不回滚已经创建好的项目。

## 验收重点

- GitHub URL 解析遇到非法 percent encoding 时返回无效，不抛异常。
- 用户确认最终远程计划前，不初始化缺失子仓、不改 `.gitmodules`、不改 remote。
- 缺失子仓初始化必须使用确认后的 `.gitmodules` URL，并先同步到 `.git/config`，避免旧子模块配置克隆错仓。
- 缺失子仓初始化前必须确认主仓 `HEAD` 已有对应路径的 gitlink；没有 gitlink 时不写 `.gitmodules`、不执行 submodule update。
- 主仓不是 Git 根目录时，不执行缺失子仓初始化；非空非 Git 子仓目录也不能执行 submodule update。
- 默认远程能复用已有 `origin` 和 `.gitmodules`。
- 默认或手输远程不能让主仓、后端、前端重复指向同一 GitHub 仓库；手输重复时留在远程输入流程内重新输入。
- 创建仓库前先保证子仓完整历史。
- 子仓 detached HEAD 可由 init 在当前提交上修复，主仓 detached HEAD 不应被 status 推荐给 init。
- 主仓 detached HEAD 时不自动创建本地初始化提交。
- `.gitmodules` 或子仓路径已有 staged 内容时不自动创建本地初始化提交。
- init 失败或中途取消能回滚本轮本地改动、本轮创建的 submodule metadata 和本轮创建的 detached 修复分支，且不删除用户原有非空子目录。
