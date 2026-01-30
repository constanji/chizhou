const path = require('path');

// 计算项目根目录
// 文件位置：api/config/paths.js
// 从 api/config 向上两级到项目根目录
// 在容器中：/app/api/config -> /app/api -> /app (项目根目录)
// 在本地：./api/config -> ./api -> . (项目根目录，解析为绝对路径)
const projectRoot = path.resolve(__dirname, '..', '..');

module.exports = {
  root: projectRoot,
  uploads: path.join(projectRoot, 'uploads'),
  clientPath: path.join(projectRoot, 'client'),
  dist: path.join(projectRoot, 'client', 'dist'),
  publicPath: path.join(projectRoot, 'client', 'public'),
  fonts: path.join(projectRoot, 'client', 'public', 'fonts'),
  assets: path.join(projectRoot, 'client', 'public', 'assets'),
  imageOutput: path.join(projectRoot, 'client', 'public', 'images'),
  // structuredTools 从项目根目录开始，加上 api 目录
  structuredTools: path.join(projectRoot, 'api', 'app', 'clients', 'tools', 'structured'),
  pluginManifest: path.join(projectRoot, 'api', 'app', 'clients', 'tools', 'manifest.json'),
};
