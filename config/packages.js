// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { deleteNodeModules } = require('./helpers');

// Set the directories
const rootDir = path.resolve(__dirname, '..');
const directories = [
  rootDir,
  path.resolve(rootDir, 'packages', 'data-provider'),
  path.resolve(rootDir, 'packages', 'data-schemas'),
  path.resolve(rootDir, 'packages', 'api'),
  path.resolve(rootDir, 'client'),
  path.resolve(rootDir, 'api'),
];

// Delete package-lock.json if it exists
const packageLockPath = path.resolve(rootDir, 'package-lock.json');
if (fs.existsSync(packageLockPath)) {
  console.purple('Deleting package-lock.json...');
  fs.unlinkSync(packageLockPath);
}

(async () => {
  // Delete all node_modules
  directories.forEach(deleteNodeModules);

  // Build agents-Aipyq if dist doesn't exist
  const agentsDistPath = path.resolve(rootDir, 'agents-Aipyq', 'dist');
  if (!fs.existsSync(agentsDistPath)) {
    console.purple('Building agents-Aipyq...');
    const agentsDir = path.resolve(rootDir, 'agents-Aipyq');
    if (fs.existsSync(path.resolve(agentsDir, 'package.json'))) {
      execSync('npm install', { cwd: agentsDir, stdio: 'inherit' });
      execSync('npm run build', { cwd: agentsDir, stdio: 'inherit' });
    } else {
      console.orange('Warning: agents-Aipyq directory not found, skipping build');
    }
  }

  // Run npm cache clean --force
  console.purple('Cleaning npm cache...');
  execSync('npm cache clean --force', { stdio: 'inherit' });

  // Install dependencies (will use local agents-Aipyq from package.json)
  console.purple('Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });
})();
