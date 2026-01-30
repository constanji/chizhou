const { execSync } = require('child_process');
const { isDockerRunning, silentExit } = require('./helpers');

async function validateDockerRunning() {
  if (!isDockerRunning()) {
    console.red(
      '错误: Docker 未运行。您需要启动 Docker Desktop，如果在 Linux/Mac 上，请运行 `sudo systemctl start docker`',
    );
    silentExit(1);
  }
}

function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
}

const shouldRebase = process.argv.includes('--rebase');

(async () => {
  console.green(
    '正在启动部署更新脚本，这可能需要一到两分钟，具体取决于您的系统和网络。',
  );

  await validateDockerRunning();
  console.purple('正在获取最新仓库...');
  execSync('git fetch origin', { stdio: 'inherit' });

  if (!shouldRebase) {
    execSync('git checkout main', { stdio: 'inherit' });
    console.purple('正在从 main 分支拉取最新代码...');
    execSync('git pull origin main', { stdio: 'inherit' });
  } else if (shouldRebase) {
    const currentBranch = getCurrentBranch();
    console.purple(`正在将 ${currentBranch} 变基到 main...`);
    execSync('git rebase origin/main', { stdio: 'inherit' });
  }

  console.purple('正在移除之前创建的 Docker 容器...');
  const downCommand = 'sudo docker compose -f ./deploy-compose.yml down';
  console.orange(downCommand);
  execSync(downCommand, { stdio: 'inherit' });

  console.purple('正在移除所有 Aipyq `deployed` 镜像标签...');
  const repositories = ['ghcr.io/constanji/Aipyq-dev-api', 'aipyq-client'];
  repositories.forEach((repo) => {
    const tags = execSync(`sudo docker images ${repo} -q`, { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    tags.forEach((tag) => {
      const removeImageCommand = `sudo docker rmi ${tag}`;
      console.orange(removeImageCommand);
      execSync(removeImageCommand, { stdio: 'inherit' });
    });
  });

  console.purple('正在拉取最新 Aipyq 镜像...');
  const pullCommand = 'sudo docker compose -f ./deploy-compose.yml pull api';
  console.orange(pullCommand);
  execSync(pullCommand, { stdio: 'inherit' });

  let startCommand = 'sudo docker compose -f ./deploy-compose.yml up -d';
  console.green('您的 Aipyq 应用现已更新！使用以下命令启动应用:');
  console.purple(startCommand);
  console.orange(
    "注意: 建议清除浏览器的 cookies 和 localStorage，以确保完全干净的安装。",
  );
  console.orange("另外: 不用担心，您的数据是安全的 :)");
})();
