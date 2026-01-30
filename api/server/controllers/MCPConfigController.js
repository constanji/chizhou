const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('@aipyq/data-schemas');
const { CacheKeys } = require('@aipyq/data-provider');
const { getLogStores } = require('~/cache');
const getConfigPath = require('~/server/utils/getConfigPath');
const { mcpServersRegistry } = require('@aipyq/api');
const { clearAppConfigCache } = require('~/server/services/Config/app');

// 获取自定义 MCP 服务器配置
async function getCustomMCPServersConfig(req, res) {
  try {
    const configPath = getConfigPath();

    // Check if config file exists and is a local file (not a URL)
    if (/^https?:\/\//.test(configPath)) {
      return res.status(400).json({
        error: 'Cannot read remote config file. Please use a local Aipyq.yaml file.',
      });
    }

    // Read the current config file
    let configContent;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 如果配置文件不存在，返回空数组而不是错误
        logger.info(`[GET /config/mcp/custom] Config file not found at ${configPath}, returning empty list`);
        return res.status(200).json({
          success: true,
          servers: [],
        });
      }
      throw error;
    }

    // Parse the YAML
    let config;
    try {
      config = yaml.load(configContent);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid YAML format in config file',
        details: error.message 
      });
    }

    const mcpServers = config.mcpServers || {};
    const servers = Object.entries(mcpServers).map(([serverName, config]) => ({
      serverName,
      config,
    }));

    return res.status(200).json({
      success: true,
      servers,
    });
  } catch (err) {
    logger.error('[GET /config/mcp/custom] Unexpected error:', err);
    return res.status(500).json({ 
      error: err.message || 'Internal server error',
    });
  }
}

// 保存自定义 MCP 服务器配置
async function saveCustomMCPServersConfig(req, res) {
  try {
    const { server } = req.body;

    if (!server || typeof server !== 'object' || !server.serverName) {
      return res.status(400).json({ error: 'server must be an object with serverName' });
    }

    const configPath = getConfigPath();

    // Check if config file exists and is a local file (not a URL)
    if (/^https?:\/\//.test(configPath)) {
      return res.status(400).json({
        error: 'Cannot update remote config file. Please use a local Aipyq.yaml file.',
      });
    }

    // Read the current config file or create a new one if it doesn't exist
    let configContent;
    let config;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
      // Parse the YAML
      try {
        config = yaml.load(configContent);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid YAML format in config file' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 如果配置文件不存在，创建一个新的空配置
        logger.info(`[POST /config/mcp/custom] Config file not found at ${configPath}, creating new file`);
        config = { version: '1.2.1', cache: true };
      } else {
      throw error;
    }
    }

    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    const { serverName, config: serverConfig } = server;
    config.mcpServers[serverName] = serverConfig;

    // Write back to file
    const updatedYaml = yaml.dump(config, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });

    await fs.writeFile(configPath, updatedYaml, 'utf8');

    // Clear the startup config cache
    const cache = getLogStores(CacheKeys.CONFIG_STORE);
    await cache.delete(CacheKeys.STARTUP_CONFIG);
    
    // Clear the app config cache to ensure getAppConfig() returns fresh config with new server
    // This is critical for connection status endpoint to include newly added servers
    try {
      await clearAppConfigCache();
      logger.info(`[MCP Config] Cleared app config cache after saving server "${serverName}"`);
    } catch (error) {
      logger.warn(`[MCP Config] Failed to clear app config cache: ${error.message}`);
      // Don't fail the request if cache clear fails, config is saved to file
    }

    // Update mcpServersRegistry rawConfigs so the new server is immediately available
    // This ensures that reinitialize endpoint can find the server config without requiring a server restart
    try {
      mcpServersRegistry.setRawConfigs(config.mcpServers || {});
      logger.info(`[MCP Config] Updated registry rawConfigs with server "${serverName}"`);
    } catch (error) {
      logger.warn(`[MCP Config] Failed to update registry rawConfigs: ${error.message}`);
      // Don't fail the request if registry update fails, config is saved to file
    }

    logger.info(`MCP server "${serverName}" ${config.mcpServers[serverName] ? 'updated' : 'added'} successfully`);

    return res.status(200).json({
      success: true,
      message: `MCP server "${serverName}" ${config.mcpServers[serverName] ? 'updated' : 'added'} successfully`,
    });
  } catch (err) {
    logger.error('Error updating MCP server config', err);
    return res.status(500).json({ error: err.message });
  }
}

// 删除自定义 MCP 服务器配置
async function deleteCustomMCPServersConfig(req, res) {
  try {
    const { serverName } = req.params;

    if (!serverName) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    const configPath = getConfigPath();

    // Check if config file exists and is a local file (not a URL)
    if (/^https?:\/\//.test(configPath)) {
      return res.status(400).json({
        error: 'Cannot update remote config file. Please use a local Aipyq.yaml file.',
      });
    }

    // Read the current config file
    let configContent;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Config file not found' });
      }
      throw error;
    }

    // Parse the YAML
    let config;
    try {
      config = yaml.load(configContent);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid YAML format in config file' });
    }

    if (!config.mcpServers || !config.mcpServers[serverName]) {
      return res.status(404).json({ error: `MCP server "${serverName}" not found` });
    }

    delete config.mcpServers[serverName];

    // Write back to file
    const updatedYaml = yaml.dump(config, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });

    await fs.writeFile(configPath, updatedYaml, 'utf8');

    // Clear the startup config cache
    const cache = getLogStores(CacheKeys.CONFIG_STORE);
    await cache.delete(CacheKeys.STARTUP_CONFIG);
    
    // Clear the app config cache to ensure getAppConfig() returns fresh config without deleted server
    // This is critical for connection status endpoint to exclude deleted servers
    try {
      await clearAppConfigCache();
      logger.info(`[MCP Config] Cleared app config cache after deleting server "${serverName}"`);
    } catch (error) {
      logger.warn(`[MCP Config] Failed to clear app config cache: ${error.message}`);
      // Don't fail the request if cache clear fails, config is saved to file
    }

    // Update mcpServersRegistry rawConfigs to remove the deleted server
    // This ensures the server is immediately unavailable without requiring a server restart
    try {
      mcpServersRegistry.setRawConfigs(config.mcpServers || {});
      logger.info(`[MCP Config] Updated registry rawConfigs after deleting server "${serverName}"`);
    } catch (error) {
      logger.warn(`[MCP Config] Failed to update registry rawConfigs: ${error.message}`);
      // Don't fail the request if registry update fails, config is saved to file
    }

    logger.info(`MCP server "${serverName}" deleted successfully`);

    return res.status(200).json({
      success: true,
      message: `MCP server "${serverName}" deleted successfully`,
    });
  } catch (err) {
    logger.error('Error deleting MCP server config', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getCustomMCPServersConfig,
  saveCustomMCPServersConfig,
  deleteCustomMCPServersConfig,
};

