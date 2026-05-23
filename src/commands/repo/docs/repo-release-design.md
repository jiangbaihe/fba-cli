# 实验性仓库维护发布设计

## 目标

本 fork 的实验性 `repo` 功能通过 GitHub Actions 自动发布 GitHub Release 包安装。

用户安装命令固定为：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
```

这个地址指向 GitHub 最新 Release 中名为 `fba-cli.tgz` 的资产。用户不需要记具体版本号。

## 边界

发布流程服务于当前 fork 的实验性功能验证，不改变上游 fba-cli 的正式发布策略。

repo 功能代码、测试和说明仍收缩在 `src/commands/repo/`。唯一允许的根目录例外是：

```text
.github/workflows/repo-release.yml
```

GitHub Actions workflow 必须放在根目录，这是 GitHub Actions 的平台要求。该例外只负责发布当前 fork 的实验性 CLI 包，不得承载 repo 运行时代码或业务逻辑。

原项目已有 `.github/workflows/release.yml` 保持原有 npm 发布流程，不作为 repo 实验性发布入口。

## Fork 发布风险

当前仓库是上游 fba-cli 的 fork。上游自带的 `.github/workflows/release.yml` 会在推送 `v*` tag 时尝试执行 npm 发布。

在 fork 中，普通分支 push 不会触发该发布流程；但如果误推 `v*` tag，且 fork 仓库启用了 GitHub Actions，该 workflow 会在 fork 中运行。由于 fork 通常没有上游项目的 `NPM_TOKEN`，也没有 `@fba/cli` 的 npm 发布权限，发布一般会失败，不会替换 npm 源上的上游包。

为了避免误触发和混淆：

- 不要为实验性版本推送 `v*` tag。
- 实验性 Release 包只使用 `repo-v*` tag。
- 不要为了实验性功能修改 `.github/workflows/release.yml`。
- 如需更保守，可以在 fork 的 GitHub Actions 页面禁用原 `Release` workflow。

源码仓库保持源码为主：

- 不提交 `dist/`
- 不提交 `*.tgz`
- 不依赖用户本机在安装时执行 TypeScript 构建
- Release 资产中必须包含已经构建好的 `dist/index.js`

`package.json` 的 `bin.fba-cli` 继续指向：

```json
{
  "bin": {
    "fba-cli": "./dist/index.js"
  }
}
```

## 触发方式

发布通过 tag 触发：

```powershell
git tag repo-v0.1.10
git push origin repo-v0.1.10
```

tag 名必须以 `repo-v` 开头。Release 名称和标题使用该 tag，避免与原项目 `v*` npm 发布流程冲突。

## Actions 流程

`.github/workflows/repo-release.yml` 在 `repo-v*` tag push 后执行：

1. checkout 当前 tag
2. 安装 pnpm
3. 安装 Node.js，并启用 pnpm 缓存
4. 安装 Bun
5. 使用 `pnpm install --frozen-lockfile` 安装依赖
6. 运行 `bun test`
7. 运行 `pnpm run typecheck`
8. 运行 `git diff --check`
9. 运行 `pnpm run build` 构建 `dist/`
10. 执行 `npm pack`
11. 将生成的版本化 `.tgz` 重命名为 `fba-cli.tgz`
12. 创建或更新 GitHub Release
13. 上传固定资产 `fba-cli.tgz`

workflow 需要：

```yaml
permissions:
  contents: write
```

不要发布到 npm registry，不需要 `NPM_TOKEN`。

## 发布产物

每次发布生成 npm 包：

```bash
npm pack
```

生成的版本化包名类似：

```text
fba-cli-0.1.10.tgz
```

上传到 GitHub Release 时，资产名统一改为：

```text
fba-cli.tgz
```

这样 latest 安装地址始终稳定。

Release 必须满足：

- 是最新 Release
- 包含资产 `fba-cli.tgz`
- 资产由当前 tag 对应源码构建
- 资产内包含 `dist/index.js`

## 安装验证

发布后，在独立目录或新终端中验证：

```powershell
npm uninstall -g @fba/cli
npm install -g https://github.com/jiangbaihe/fba-cli/releases/latest/download/fba-cli.tgz
fba-cli --help
fba-cli repo --help
```

预期：

- `fba-cli --help` 可运行
- `fba-cli repo --help` 显示 `init`、`status`、`sync`、`push`
- 安装过程不需要用户本机执行源码构建

## 与 Git 安装方案的取舍

Git 分支安装可以写成：

```powershell
npm install -g git+https://github.com/jiangbaihe/fba-cli.git#master
```

但这种方式需要在安装时构建源码，容易受用户本机 Node/npm 环境、包管理器行为和构建脚本影响。

当前选择 Actions 自动发布 Release 包，是为了让安装路径更稳定：

- 用户命令固定
- 不需要记版本号
- 不提交 `dist/`
- 不需要本地手动上传资产
- 安装的是 CI 验证过的 npm 包产物

## 非目标

当前阶段不做：

- 自动发布到 npm registry
- 自动发布到 GitHub Packages
- 在源码仓库提交 `dist/`
- 在安装时依赖 `prepare` 构建
- 本地脚本或手动网页上传作为主发布路径
- 为每个历史版本维护独立安装说明

## 验收

发布方案完成时必须满足：

- `dist/` 不进入 Git 提交
- `.tgz` 不进入 Git 提交
- `.github/workflows/repo-release.yml` 不包含 `pnpm publish` 或 `NPM_TOKEN`
- `.github/workflows/release.yml` 保留原项目 npm 发布流程
- Actions 发布前会运行 `bun test`
- Actions 构建出的包包含 `dist/index.js`
- GitHub 最新 Release 包含固定资产 `fba-cli.tgz`
- 固定 latest URL 可以全局安装
- `fba-cli repo --help` 在安装后可用
- 发布流程沿用源项目已有 GitHub Actions 结构、依赖安装、类型检查和构建脚本；只把发布目标调整为 GitHub Release 资产
