// create.ts — 项目创建完整流程
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { join, resolve } from "path";
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "fs";
import { t, setLanguage } from "../lib/i18n.js";
import {
  readGlobalConfig,
  writeGlobalConfig,
  isFirstRun,
  addProject,
  writeProjectConfig,
} from "../lib/config.js";
import {
  checkEnvironment,
  getMissingTools,
  getMissingRequiredTools,
} from "../lib/env-check.js";
import { installTool } from "../lib/env-install.js";
import { gitClone } from "../lib/git.js";
import {
  cloneRepositoryForMaintenance,
  repoCreateText,
} from "./repo/internal/create-integration.js";
import { isDockerAvailable, composeUp, composeDown } from "../lib/docker.js";
import {
  createInfraDir,
  DEFAULT_INFRA_CONFIG,
  getDefaultsForDbType,
  type InfraConfig,
  type DatabaseType,
} from "../lib/infra.js";
import {
  getDefaultBackendEnv,
  serializeBackendEnv,
} from "../templates/backend.env.js";
import { run, runInherited } from "../lib/process.js";
import type { ProjectConfig } from "../types/config.js";
import {
  NPM_REGISTRIES,
  PYPI_REGISTRIES,
  getRegistryLabel,
  selectNpmRegistry,
  selectPypiRegistry,
} from "../lib/registry.js";

const LOGO = `
  ███████╗██████╗  █████╗       ██████╗██╗     ██╗
  ██╔════╝██╔══██╗██╔══██╗     ██╔════╝██║     ██║
  █████╗  ██████╔╝███████║     ██║     ██║     ██║
  ██╔══╝  ██╔══██╗██╔══██║     ██║     ██║     ██║
  ██║     ██████╔╝██║  ██║     ╚██████╗███████╗██║
  ╚═╝     ╚═════╝ ╚═╝  ╚═╝      ╚═════╝╚══════╝╚═╝
`;

const BACKEND_REPO =
  "https://github.com/fastapi-practices/fastapi-best-architecture.git";
const FRONTEND_REPO =
  "https://github.com/fastapi-practices/fastapi-best-architecture-ui.git";

// ─── 回退机制 ───
let _cleanupDir: string | null = null;
let _infraDir: string | null = null;

function normalizeProjectRootInput(value?: string): string {
  const projectRoot = value?.trim();
  return projectRoot ? resolve(projectRoot) : process.cwd();
}

async function cleanup() {
  if (!_cleanupDir) return;
  console.log(chalk.yellow(`\n\n  ⟲ ${t("rollingBack")} ${_cleanupDir}`));

  // 先尝试停止 docker compose
  if (_infraDir && existsSync(_infraDir)) {
    try {
      await composeDown(_infraDir, "Stopping infrastructure");
    } catch {
      // ignore
    }
  }

  // 删除项目目录
  try {
    rmSync(_cleanupDir, { recursive: true, force: true });
    console.log(chalk.green(`  ✓ ${t("cleanupComplete")}\n`));
  } catch (e: any) {
    console.error(chalk.red(`  ✗ ${t("cleanupFailed")}: ${e.message}`));
    console.error(chalk.dim(`    ${t("manualRemoveHint")} ${_cleanupDir}\n`));
  }

  _cleanupDir = null;
  _infraDir = null;
}

function onCancel(): never {
  cleanup().then(() => process.exit(0));
  // 同步退出保底
  process.exit(0);
}

function formatEnvCheckStatus(check: {
  name: string;
  command: string;
  found: boolean;
  version?: string;
}) {
  if (!check.found) {
    return chalk.red(`✗ ${check.name} ${t("envNotFound")}`);
  }

  const rawVersion = check.version?.trim() ?? "";
  const loweredVersion = rawVersion.toLowerCase();
  const prefixes = [check.name, check.command]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const displayVersion = prefixes.some((prefix) =>
    loweredVersion.startsWith(`${prefix} `),
  )
    ? rawVersion.slice(rawVersion.indexOf(" ") + 1).trim()
    : rawVersion;

  return chalk.green(
    `✓ ${check.name}${displayVersion ? ` ${displayVersion}` : ""}`,
  );
}

export async function createAction() {
  // ─── 注册 SIGINT 清理 ───
  const sigintHandler = () => {
    cleanup().then(() => process.exit(130));
  };
  process.on("SIGINT", sigintHandler);

  try {
    await _createFlow();
  } catch (e: any) {
    // 非正常退出（非用户取消）回退
    if (_cleanupDir) {
      console.error(chalk.red(`\n  ✗ Error: ${e.message}`));
      await cleanup();
    }
    process.exit(1);
  } finally {
    // 创建成功后移除 handler，不再需要清理
    process.removeListener("SIGINT", sigintHandler);
    _cleanupDir = null;
    _infraDir = null;
  }
}

async function _createFlow() {
  // ─── 欢迎 & 语言 ───
  console.log(chalk.cyan(LOGO));
  clack.intro(chalk.bgCyan(" fba-cli "));

  // 首次使用选择语言
  if (isFirstRun()) {
    const lang = await clack.select({
      message: "Select language / 选择语言",
      options: [
        { value: "zh", label: "中文" },
        { value: "en", label: "English" },
      ],
    });
    if (clack.isCancel(lang)) onCancel();
    setLanguage(lang as "zh" | "en");
    const config = readGlobalConfig();
    config.language = lang as "zh" | "en";
    writeGlobalConfig(config);
  }

  clack.log.info(chalk.bold(t("welcome")));

  // ─── 源选择（首次或未配置时引导） ───
  {
    const gCfg = readGlobalConfig();
    let needWrite = false;

    if (!gCfg.npmRegistry) {
      clack.log.step(t("registrySetupTitle"));
      const npmUrl = await selectNpmRegistry();
      if (clack.isCancel(npmUrl)) onCancel();
      gCfg.npmRegistry = npmUrl as string;
      needWrite = true;
    }

    if (!gCfg.pypiRegistry) {
      if (!needWrite) clack.log.step(t("registrySetupTitle"));
      const pypiUrl = await selectPypiRegistry();
      if (clack.isCancel(pypiUrl)) onCancel();
      gCfg.pypiRegistry = pypiUrl as string;
      needWrite = true;
    }

    if (needWrite) {
      writeGlobalConfig(gCfg);
      clack.log.success(
        `npm: ${getRegistryLabel(NPM_REGISTRIES, gCfg.npmRegistry)}  |  PyPI: ${getRegistryLabel(PYPI_REGISTRIES, gCfg.pypiRegistry)}`,
      );
    }
  }

  // ─── 环境检测 ───
  const envSpinner = clack.spinner();
  envSpinner.start(t("envChecking"));
  const envSummary = await checkEnvironment();
  envSpinner.stop(t("envChecking"));

  // 输出检测结果
  for (const [, check] of Object.entries(envSummary)) {
    const tag = check.required
      ? chalk.yellow(`(${t("envRequired")})`)
      : chalk.dim(`(${t("envOptional")})`);
    const status = check.found
      ? chalk.green(`✓ ${check.name} ${check.version ?? ""}`) + ` ${tag}`
      : chalk.red(`✗ ${check.name} ${t("envNotFound")}`) + ` ${tag}`;
    clack.log.info(status);
  }

  // 处理所有缺失的工具（必要 + 可选）
  const missing = getMissingTools(envSummary);
  if (missing.length > 0) {
    const shouldInstall = await clack.confirm({ message: t("envMissing") });
    if (clack.isCancel(shouldInstall)) onCancel();

    if (shouldInstall) {
      const toInstall = await clack.multiselect({
        message: `${t("envSelectInstall")} ${chalk.dim(t("multiselectHint"))}`,
        options: missing.map((m) => ({
          value: m.command,
          label: `${m.name} ${m.required ? chalk.yellow(`(${t("envRequired")})`) : chalk.dim(`(${t("envOptional")})`)}`,
        })),
        initialValues: missing.map((m) => m.command),
      });
      if (clack.isCancel(toInstall)) onCancel();

      for (const cmd of toInstall) {
        const tool = missing.find((m) => m.command === cmd);
        if (tool) {
          const ok = await installTool(tool);
          clack.log.info(
            ok
              ? chalk.green(`✓ ${tool.name} ${t("envInstallSuccess")}`)
              : chalk.red(`✗ ${tool.name} ${t("envInstallFail")}`),
          );
        }
      }
    }

    // 安装后重新检测必要工具是否就绪
    const recheck = await checkEnvironment();
    const stillMissing = getMissingRequiredTools(recheck);
    if (stillMissing.length > 0) {
      clack.log.error(
        chalk.red(
          `${stillMissing.map((m) => m.name).join(", ")} ${t("envRequired")}`,
        ),
      );
      process.exit(1);
    }
  }

  // ─── 项目配置 ───
  const projectConfig = await clack.group(
    {
      projectRoot: () =>
        clack.text({
          message: t("projectRoot"),
          placeholder: process.cwd(),
          defaultValue: process.cwd(),
          validate: (v) => {
            const resolvedRoot = normalizeProjectRootInput(v);
            if (!existsSync(resolvedRoot)) return t("projectRootNotExist");

            try {
              if (!statSync(resolvedRoot).isDirectory()) {
                return t("projectRootNotDirectory");
              }
            } catch {
              return t("projectRootNotDirectory");
            }

            return undefined;
          },
        }),
      projectName: ({ results }) =>
        clack.text({
          message: t("projectName"),
          placeholder: "my-fba-project",
          validate: (v) => {
            if (!v?.trim()) return t("projectNameRequired");
            const projectRoot = normalizeProjectRootInput(
              results.projectRoot as string | undefined,
            );
            if (existsSync(join(projectRoot, v.trim())))
              return t("projectNameExists");
            return undefined;
          },
        }),
      backendName: () =>
        clack.text({
          message: t("backendName"),
          placeholder: "fastapi-best-architecture",
          defaultValue: "fastapi-best-architecture",
        }),
      frontendName: () =>
        clack.text({
          message: t("frontendName"),
          placeholder: "fastapi-best-architecture-ui",
          defaultValue: "fastapi-best-architecture-ui",
        }),
    },
    {
      onCancel: () => onCancel(),
    },
  );

  const projectRoot = normalizeProjectRootInput(projectConfig.projectRoot);
  const projectName = String(projectConfig.projectName);
  const backendName = String(projectConfig.backendName);
  const frontendName = String(projectConfig.frontendName);
  const projectDir = join(projectRoot, projectName);

  const enableRepoMaintenance = await clack.confirm({
    message: repoCreateText.maintenanceQuestion(),
    initialValue: false,
  });
  if (clack.isCancel(enableRepoMaintenance)) onCancel();

  // 创建项目目录 → 从此刻起需要回退
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }
  _cleanupDir = projectDir;

  // ─── 仓库克隆 ───
  clack.log.step(t("cloningRepos"));

  const backendDir = join(projectDir, backendName);
  const frontendDir = join(projectDir, frontendName);

  const cloneForCreate = enableRepoMaintenance
    ? cloneRepositoryForMaintenance
    : gitClone;
  const backendCloned = await cloneForCreate(BACKEND_REPO, backendDir, {
    label: `${t("labelBackend")} → ${backendName}`,
  });
  const frontendCloned = await cloneForCreate(FRONTEND_REPO, frontendDir, {
    label: `${t("labelFrontend")} → ${frontendName}`,
  });

  if (!backendCloned || !frontendCloned) {
    clack.log.error(chalk.red(t("cloneFail")));
    if (!backendCloned)
      clack.log.info(`  git clone ${BACKEND_REPO} ${backendDir}`);
    if (!frontendCloned)
      clack.log.info(`  git clone ${FRONTEND_REPO} ${frontendDir}`);
    await cleanup();
    return process.exit(1);
  }
  clack.log.success(t("cloneSuccess"));

  // ─── 数据库类型选择（始终需要，用于后端 .env 配置） ───
  const dbTypeChoice = await clack.select({
    message: t("dbTypeSelect"),
    options: [
      { value: "postgresql", label: t("infraPostgres") },
      { value: "mysql", label: t("infraMysql") },
    ],
  });
  if (clack.isCancel(dbTypeChoice)) onCancel();
  const selectedDbType: DatabaseType = dbTypeChoice as DatabaseType;

  // ─── 基础设施（Docker 安装） ───
  // 先检查 Docker 是否可用，不可用则跳过基础设施选择
  const dockerOk = await isDockerAvailable();
  let infraServices: string[] = [];
  let infraConfig: InfraConfig = {
    ...DEFAULT_INFRA_CONFIG,
    ...getDefaultsForDbType(selectedDbType),
  };
  let hasInfra = false;

  if (!dockerOk) {
    clack.log.warn(chalk.yellow(t("infraDockerFail")));
  } else {
    clack.log.info(chalk.cyan(t("infraDescription")));
    clack.log.info(chalk.dim(t("infraSkipHint")));

    const infraSelection = await clack.multiselect({
      message: `${t("infraSelect")} ${chalk.dim(`(${t("envOptional")})`)} ${chalk.dim(t("multiselectHint"))}`,
      options: [
        {
          value: "database",
          label:
            selectedDbType === "mysql" ? t("infraMysql") : t("infraPostgres"),
          hint: t("hintDatabase"),
        },
        { value: "redis", label: t("infraRedis"), hint: t("hintCache") },
        {
          value: "rabbitmq",
          label: t("infraRabbitmq"),
          hint: t("hintMessageQueue"),
        },
      ],
      initialValues: ["database", "redis", "rabbitmq"],
      required: false,
    });
    if (clack.isCancel(infraSelection)) onCancel();

    // 将 'database' 替换为实际的服务名 ('postgres' | 'mysql')
    infraServices = infraSelection.map((s: string) => {
      if (s === "database")
        return selectedDbType === "mysql" ? "mysql" : "postgres";
      return s;
    });

    if (infraServices.length > 0) {
      // 创建 infra 目录（使用默认配置）
      createInfraDir(projectDir, infraServices, infraConfig);
      _infraDir = join(projectDir, "infra");
      hasInfra = true;
      clack.log.success(`infra/ ✓`);
    }
  }

  // ─── 服务连接信息配置（始终提示） ───
  if (!hasInfra) {
    clack.log.warn(chalk.yellow(t("infraExternalHint")));
  }
  clack.log.step(t("envConfigTitle"));

  // 辅助：根据服务是否由 Docker 管理生成 hint
  const dbServiceName = selectedDbType === "mysql" ? "mysql" : "postgres";
  const hint = (service: string) =>
    infraServices.includes(service)
      ? chalk.dim(t("envConfigHintDocker"))
      : chalk.dim(t("envConfigHintExternal"));

  // 数据库连接配置
  const dbConfig = await clack.group(
    {
      dbHost: () =>
        clack.text({
          message: `${t("dbHost")} ${hint(dbServiceName)}`,
          defaultValue: infraConfig.dbHost,
        }),
      dbPort: () =>
        clack.text({
          message: `${t("dbPort")} ${hint(dbServiceName)}`,
          defaultValue: String(infraConfig.dbPort),
        }),
      dbUser: () =>
        clack.text({
          message: `${t("dbUser")} ${hint(dbServiceName)}`,
          defaultValue: infraConfig.dbUser,
        }),
      dbPassword: () =>
        clack.text({
          message: `${t("dbPassword")} ${hint(dbServiceName)}`,
          defaultValue: infraConfig.dbPassword,
        }),
    },
    { onCancel: () => onCancel() },
  );
  infraConfig.dbHost = dbConfig.dbHost;
  infraConfig.dbPort = parseInt(dbConfig.dbPort);
  infraConfig.dbUser = dbConfig.dbUser;
  infraConfig.dbPassword = dbConfig.dbPassword;

  // Redis 连接配置
  const redisConfig = await clack.group(
    {
      redisHost: () =>
        clack.text({
          message: `${t("redisHost")} ${hint("redis")}`,
          defaultValue: infraConfig.redisHost,
        }),
      redisPort: () =>
        clack.text({
          message: `${t("redisPort")} ${hint("redis")}`,
          defaultValue: String(infraConfig.redisPort),
        }),
      redisPassword: () =>
        clack.text({
          message: `${t("redisPassword")} ${hint("redis")}`,
          defaultValue: infraConfig.redisPassword,
        }),
    },
    { onCancel: () => onCancel() },
  );
  infraConfig.redisHost = redisConfig.redisHost;
  infraConfig.redisPort = parseInt(redisConfig.redisPort);
  infraConfig.redisPassword = redisConfig.redisPassword;

  // RabbitMQ 连接配置
  const mqConfig = await clack.group(
    {
      mqHost: () =>
        clack.text({
          message: `${t("mqHost")} ${hint("rabbitmq")}`,
          defaultValue: infraConfig.mqHost,
        }),
      mqPort: () =>
        clack.text({
          message: `${t("mqPort")} ${hint("rabbitmq")}`,
          defaultValue: String(infraConfig.mqPort),
        }),
      mqManagePort: () =>
        clack.text({
          message: `${t("mqManagePort")} ${hint("rabbitmq")}`,
          defaultValue: String(infraConfig.mqManagePort),
        }),
      mqUser: () =>
        clack.text({
          message: `${t("mqUser")} ${hint("rabbitmq")}`,
          defaultValue: infraConfig.mqUser,
        }),
      mqPassword: () =>
        clack.text({
          message: `${t("mqPassword")} ${hint("rabbitmq")}`,
          defaultValue: infraConfig.mqPassword,
        }),
    },
    { onCancel: () => onCancel() },
  );
  infraConfig.mqHost = mqConfig.mqHost;
  infraConfig.mqPort = parseInt(mqConfig.mqPort);
  infraConfig.mqManagePort = parseInt(mqConfig.mqManagePort);
  infraConfig.mqUser = mqConfig.mqUser;
  infraConfig.mqPassword = mqConfig.mqPassword;

  // 如果有 Docker 基础设施，用最新配置更新 infra 目录
  if (hasInfra) {
    createInfraDir(projectDir, infraServices, infraConfig);
  }

  // ─── 后端 .env ───
  const backendEnvConfig = getDefaultBackendEnv(infraConfig, selectedDbType);

  // 额外配置
  const portConfig = await clack.group(
    {
      serverPort: () =>
        clack.text({ message: t("serverPort"), defaultValue: "8000" }),
      webPort: () =>
        clack.text({ message: t("webPort"), defaultValue: "5173" }),
    },
    { onCancel: () => onCancel() },
  );

  const serverPort = parseInt(portConfig.serverPort);
  const webPort = parseInt(portConfig.webPort);

  // 写入后端 .env
  const backendEnvPath = join(backendDir, "backend", ".env");
  writeFileSync(backendEnvPath, serializeBackendEnv(backendEnvConfig), "utf-8");
  clack.log.success(`backend/.env ✓`);

  // 写入前端 .env.development
  const frontendEnvPath = join(
    frontendDir,
    "apps",
    "web-antdv-next",
    ".env.development",
  );
  if (existsSync(join(frontendDir, "apps", "web-antdv-next"))) {
    writeFileSync(
      frontendEnvPath,
      `VITE_GLOB_API_URL=http://127.0.0.1:${serverPort}\nVITE_PORT=${webPort}\n`,
      "utf-8",
    );
    clack.log.success(`.env.development ✓`);
  }

  // ─── 写入项目配置 ───
  const projConfig: ProjectConfig = {
    name: projectName,
    backend_name: backendName,
    frontend_name: frontendName,
    server_port: serverPort,
    web_port: webPort,
    infra: hasInfra,
    infra_services: infraServices,
    db_type: selectedDbType,
  };
  writeProjectConfig(projectDir, projConfig);

  // ─── 初始化 ───
  clack.log.step(t("initProject"));

  // 1. 启动基础设施
  if (hasInfra) {
    const infraDir = join(projectDir, "infra");
    const ok = await composeUp(infraDir, t("initInfra"));
    if (!ok) {
      clack.log.warn(chalk.yellow(`${t("initInfra")} ${t("initFailed")}`));
    }
  }

  // 2. 前端依赖安装（可选）
  const installFrontend = await clack.confirm({
    message: `${t("initFrontend")}?`,
    initialValue: false,
  });
  if (!clack.isCancel(installFrontend) && installFrontend) {
    const pnpmArgs = ["install"];
    const gCfgPnpm = readGlobalConfig();
    if (
      gCfgPnpm.npmRegistry &&
      gCfgPnpm.npmRegistry !== "https://registry.npmjs.org"
    ) {
      pnpmArgs.push("--registry", gCfgPnpm.npmRegistry);
    }
    const result = await run("pnpm", pnpmArgs, {
      cwd: frontendDir,
      spinner: true,
      label: t("initFrontend"),
    });
    if (result.exitCode !== 0) {
      clack.log.warn(
        chalk.yellow(`${t("initFrontend")} ${t("initFailed")}: pnpm install`),
      );
    }
  }

  // 3. Python 环境（可选）
  let pythonReady = false;
  const initPython = await clack.confirm({
    message: `${t("initPython")}?`,
    initialValue: false,
  });
  if (!clack.isCancel(initPython) && initPython) {
    const gCfgUv = readGlobalConfig();
    const uvExtra: string[] = [];
    if (
      gCfgUv.pypiRegistry &&
      gCfgUv.pypiRegistry !== "https://pypi.org/simple"
    ) {
      uvExtra.push("--index-url", gCfgUv.pypiRegistry);
    }
    // uv venv
    let ok = await run("uv", ["venv"], {
      cwd: backendDir,
      spinner: true,
      label: "uv venv",
    });
    if (ok.exitCode === 0) {
      // uv sync
      ok = await run("uv", ["sync", ...uvExtra], {
        cwd: backendDir,
        spinner: true,
        label: "uv sync",
      });
    }
    if (ok.exitCode !== 0) {
      clack.log.warn(chalk.yellow(`${t("initPython")} ${t("initFailed")}`));
    } else {
      pythonReady = true;
    }
  }

  // 4. 初始化 FBA 服务（依赖 Python 环境就绪）
  if (pythonReady) {
    const initFba = await clack.confirm({
      message: `${t("initFba")}?`,
      initialValue: false,
    });
    if (!clack.isCancel(initFba) && initFba) {
      const fbaInitExit = await runInherited(
        "uv",
        ["run", "fba", "init"],
        backendDir,
      );
      if (fbaInitExit !== 0) {
        clack.log.warn(chalk.yellow(`${t("initFba")} ${t("initFailed")}`));
      }
    }
  }

  // ─── 插件安装 ───
  const installPlugins = await clack.confirm({
    message: t("pluginInstallQuestion"),
    initialValue: false,
  });
  if (!clack.isCancel(installPlugins) && installPlugins) {
    // 延迟导入插件市场功能
    const { pluginMarketFlow } = await import("./plugin/add.js");
    await pluginMarketFlow(projectDir);
  }

  // ─── 注册项目 ───
  addProject({
    name: projectName,
    path: projectDir,
    createdAt: new Date().toISOString(),
  });

  // 项目创建已经完成；后续实验性仓库维护失败时只回滚仓库维护自身。
  _cleanupDir = null;
  _infraDir = null;

  if (enableRepoMaintenance) {
    const runRepoInit = await clack.confirm({
      message: repoCreateText.initNowQuestion(),
      initialValue: true,
    });
    if (!clack.isCancel(runRepoInit) && runRepoInit) {
      try {
        const { repoInitAction } = await import("./repo/init.js");
        const initialized = await repoInitAction({ projectDir });
        if (!initialized) {
          clack.log.warn(chalk.yellow(repoCreateText.initFailedHint()));
        }
      } catch {
        clack.log.warn(chalk.yellow(repoCreateText.initFailedHint()));
      }
    }
  }

  // ─── 完成 ───
  clack.log.success(chalk.green.bold(t("createSuccess")));
  clack.note(
    [
      `cd ${projectDir}`,
      `fba-cli dev              # ${t("cmdDev")}`,
      `fba-cli dev web          # ${t("cmdDevWeb")}`,
      `fba-cli dev celery <sub> # ${t("cmdDevCelery")}`,
      `fba-cli dev all          # ${t("cmdDevAll")}`,
    ].join("\n"),
    t("nextSteps"),
  );
  clack.outro(chalk.cyan(t("happyCoding")));

  // 创建成功，不再需要回退
  _cleanupDir = null;
  _infraDir = null;
}
