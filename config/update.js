// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { askQuestion, isDockerRunning, deleteNodeModules, silentExit } = require('./helpers');

const config = {
  bun: process.argv.includes('-b'),
  local: process.argv.includes('-l'),
  docker: process.argv.includes('-d'),
  singleCompose: process.argv.includes('-s'),
  useSudo: process.argv.includes('--sudo'),
  skipGit: process.argv.includes('-g'),
};

// Set the directories
const rootDir = path.resolve(__dirname, '..');
const directories = [
  rootDir,
  path.resolve(rootDir, 'packages', 'data-provider'),
  path.resolve(rootDir, 'packages', 'data-schemas'),
  path.resolve(rootDir, 'packages', 'client'),
  path.resolve(rootDir, 'packages', 'api'),
  path.resolve(rootDir, 'client'),
  path.resolve(rootDir, 'api'),
];

async function updateConfigWithWizard() {
  if (!config.docker && !config.singleCompose) {
    config.docker = (await askQuestion('您是否使用 Docker? (y/n): '))
      .toLowerCase()
      .startsWith('y');
  }

  if (config.docker && !config.singleCompose) {
    config.singleCompose = !(
      await askQuestion('您是否使用默认的 docker-compose 文件? (y/n): ')
    )
      .toLowerCase()
      .startsWith('y');
  }
}

async function validateDockerRunning() {
  if (!config.docker && config.singleCompose) {
    config.docker = true;
  }

  if (config.docker && !isDockerRunning()) {
    console.red(
      '错误: Docker 未运行。您需要启动 Docker Desktop，如果在 Linux/Mac 上，请运行 `sudo systemctl start docker`',
    );
    silentExit(1);
  }
}

(async () => {
  const showWizard = !config.local && !config.docker && !config.singleCompose;

  if (showWizard) {
    await updateConfigWithWizard();
  }

  console.green(
    '正在启动更新脚本，这可能需要一到两分钟，具体取决于您的系统和网络。',
  );

  await validateDockerRunning();
  const { docker, singleCompose, useSudo, skipGit, bun } = config;
  const sudo = useSudo ? 'sudo ' : '';
  if (!skipGit) {
    // Fetch latest repo
    console.purple('正在获取最新仓库...');
    execSync('git fetch origin', { stdio: 'inherit' });

    // Switch to main branch
    console.purple('正在切换到 main 分支...');
    execSync('git checkout main', { stdio: 'inherit' });

    // Git pull origin main
    console.purple('正在从 main 分支拉取最新代码...');
    execSync('git pull origin main', { stdio: 'inherit' });
  }

  if (docker) {
    console.purple('正在移除之前创建的 Docker 容器...');
    const downCommand = `${sudo}docker compose ${
      singleCompose ? '-f ./docs/dev/single-compose.yml ' : ''
    }down`;
    console.orange(downCommand);
    execSync(downCommand, { stdio: 'inherit' });
    console.purple('正在清理所有 Aipyq Docker 镜像...');

    const imageName = singleCompose ? 'Aipyq_single' : 'Aipyq';
    try {
      execSync(`${sudo}docker rmi ${imageName}:latest`, { stdio: 'inherit' });
    } catch (e) {
      console.purple('无法移除 Docker 镜像 Aipyq:latest。它可能不存在。');
    }
    console.purple('正在移除所有未使用的悬空 Docker 镜像...');
    execSync(`${sudo}docker image prune -f`, { stdio: 'inherit' });
    console.purple('正在构建新的 Aipyq 镜像...');
    const buildCommand = `${sudo}docker compose ${
      singleCompose ? '-f ./docs/dev/single-compose.yml ' : ''
    }build --no-cache`;
    console.orange(buildCommand);
    execSync(buildCommand, { stdio: 'inherit' });
  } else {
    // Delete all node_modules
    directories.forEach(deleteNodeModules);

    // Build agents-Aipyq if dist doesn't exist (needed for local package installation)
    const agentsDistPath = path.resolve(rootDir, 'agents-Aipyq', 'dist');
    if (!fs.existsSync(agentsDistPath)) {
      console.purple('正在构建 agents-Aipyq...');
      const agentsDir = path.resolve(rootDir, 'agents-Aipyq');
      if (fs.existsSync(path.resolve(agentsDir, 'package.json'))) {
        try {
          execSync('npm install', { cwd: agentsDir, stdio: 'inherit' });
          execSync('npm run build', { cwd: agentsDir, stdio: 'inherit' });
        } catch (error) {
          console.orange('警告: 构建 agents-Aipyq 失败，继续执行...');
        }
      } else {
        console.orange('警告: 未找到 agents-Aipyq 目录，跳过构建');
      }
    }

    // Run npm cache clean --force
    console.purple('正在清理 npm 缓存...');
    execSync('npm cache clean --force', { stdio: 'inherit' });

    // Install dependencies (will use local agents-Aipyq from package.json)
    console.purple('正在安装依赖...');
    execSync('npm ci', { stdio: 'inherit' });

    // Build client-side code
    console.purple('正在构建前端...');
    execSync(bun ? 'bun b:client' : 'npm run frontend', { stdio: 'inherit' });
  }

  let startCommand = 'npm run backend';
  if (docker) {
    startCommand = `${sudo}docker compose ${
      singleCompose ? '-f ./docs/dev/single-compose.yml ' : ''
    }up`;
  }
  console.green('您的 Aipyq 应用现已更新！使用以下命令启动应用:');
  console.purple(startCommand);
  console.orange(
    "注意: 建议清除浏览器的 cookies 和 localStorage，以确保完全干净的安装。",
  );
  console.orange("另外: 不用担心，您的数据是安全的 :)");
})();
