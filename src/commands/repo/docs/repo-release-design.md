# repo 发布设计摘要

## 目标

当前 fork 的实验性版本通过 GitHub Release 包安装，不通过提交 `dist/` 或发布 npm 包安装。

用户安装最新实验版本的命令为：

```powershell
npm install -g https://github.com/jiangbaihe/fba-cli/releases/download/repo-latest/fba-cli.tgz
```

## 关键规则

- Release tag 固定为 `repo-latest`。
- Release 资产名固定为 `fba-cli.tgz`。
- 安装 URL 必须指向 `releases/download/repo-latest/fba-cli.tgz`，不能使用 `releases/latest/download`，因为原项目 `v*` Release 也可能成为 GitHub latest。
- 实验性版本只覆盖 `repo-latest`，不维护多个实验版本 Release。
- 不要为实验性版本推送原项目 `v*` tag；`v*` 属于原项目 npm 发布 workflow。
- 不提交 `dist/` 或 `.tgz`。
- `.github/workflows/repo-release.yml` 是唯一允许的 repo 发布根目录例外。
- 不改写原项目 `.github/workflows/release.yml`。
- 发布前沿用源项目脚本和工具链：测试、类型检查、空白检查、构建、`npm pack`。

发布命令：

```powershell
git tag -f repo-latest
git push origin repo-latest --force
```

workflow 必须产出并上传：

```text
fba-cli.tgz
```

包内必须包含 `dist/index.js`，因为 `package.json` 的 `bin` 指向它。

## 验收重点

- `npm pack` 产物包含 `dist/index.js`。
- `repo-latest` GitHub Release 包含固定资产 `fba-cli.tgz`。
- 安装命令始终使用固定 `repo-latest` URL。
- 原项目 npm 发布 workflow 保持不变。
