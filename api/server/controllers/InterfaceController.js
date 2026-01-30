const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('@aipyq/data-schemas');
const { interfaceSchema } = require('@aipyq/data-provider');
const getConfigPath = require('~/server/utils/getConfigPath');

async function updateInterfaceConfig(req, res) {
  try {
    const { interface: interfaceConfig } = req.body;

    if (!interfaceConfig) {
      return res.status(400).json({ error: 'Interface configuration is required' });
    }

    logger.info(`[updateInterfaceConfig] Received config:`, JSON.stringify(interfaceConfig, null, 2));

    // 验证配置
    const validationResult = interfaceSchema.safeParse(interfaceConfig);
    if (!validationResult.success) {
      logger.error(`[updateInterfaceConfig] Validation failed:`, JSON.stringify(validationResult.error.errors, null, 2));
      return res.status(400).json({
        error: 'Invalid interface configuration',
        details: validationResult.error.errors,
      });
    }

    const configPath = getConfigPath();
    logger.info(`[updateInterfaceConfig] Using config file path: ${configPath}`);

    // Check if config file exists and is a local file (not a URL)
    if (/^https?:\/\//.test(configPath)) {
      return res.status(400).json({
        error: 'Cannot update remote config file. Please use a local Aipyq.yaml file.',
      });
    }

    // 读取现有的 YAML 文件或创建新配置
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
        logger.info(`[POST /config/interface] Config file not found at ${configPath}, creating new file`);
        config = { version: '1.2.1', cache: true };
      } else {
        throw error;
      }
    }

    // 合并 interface 配置，保留现有配置中的其他字段
    // 如果现有配置中没有 interface，直接设置
    // 如果有，则深度合并（包括嵌套对象）
    if (config.interface) {
      // 深度合并，确保所有字段都被正确保存
      // 只更新传入的字段，保留其他现有字段
      const mergedInterface = {
        ...config.interface,
      };
      
      // 只更新传入的字段
      Object.keys(interfaceConfig).forEach((key) => {
        const value = interfaceConfig[key];
        if (value !== undefined) {
          // 对于嵌套对象，深度合并
          if (key === 'peoplePicker' && typeof value === 'object' && value !== null) {
            mergedInterface.peoplePicker = {
              ...(config.interface.peoplePicker || {}),
              ...value,
            };
          } else if (key === 'marketplace' && typeof value === 'object' && value !== null) {
            mergedInterface.marketplace = {
              ...(config.interface.marketplace || {}),
              ...value,
            };
          } else {
            // 对于普通字段，直接更新
            // 如果传入的是空字符串，转换为 undefined（表示清除配置）
            if (key === 'customWelcome' || key === 'defaultEndpoint' || key === 'defaultModel') {
              mergedInterface[key] = value === '' ? undefined : value;
            } else {
              mergedInterface[key] = value;
            }
          }
        }
      });
      
      config.interface = mergedInterface;
    } else {
      // 如果没有现有配置，直接使用传入的配置
      // 但需要处理空字符串
      const processedConfig = { ...interfaceConfig };
      if (processedConfig.customWelcome === '') {
        processedConfig.customWelcome = undefined;
      }
      if (processedConfig.defaultEndpoint === '') {
        processedConfig.defaultEndpoint = undefined;
      }
      if (processedConfig.defaultModel === '') {
        processedConfig.defaultModel = undefined;
      }
      config.interface = processedConfig;
    }

    logger.info(`[updateInterfaceConfig] Merged config.interface:`, JSON.stringify(config.interface, null, 2));

    // 保存回 YAML 文件
    try {
      const yamlString = yaml.dump(config, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
      
      // 检查文件是否存在，如果不存在则创建目录
      const configDir = path.dirname(configPath);
      try {
        await fs.access(configDir);
      } catch {
        await fs.mkdir(configDir, { recursive: true });
      }
      
      // 写入文件
      await fs.writeFile(configPath, yamlString, 'utf8');
      
      // 验证文件是否写入成功：读取文件并验证内容
      try {
        const verifyContents = await fs.readFile(configPath, 'utf8');
        const verifyConfig = yaml.load(verifyContents);
        
        // 验证 interface 配置是否真的被保存
        if (!verifyConfig.interface) {
          throw new Error('Configuration was written but verification failed: interface not found in saved file');
        }
        
        // 验证关键字段是否被保存
        const savedCustomWelcome = verifyConfig.interface.customWelcome;
        const savedDefaultEndpoint = verifyConfig.interface.defaultEndpoint;
        const savedDefaultModel = verifyConfig.interface.defaultModel;
        
        logger.info(`[updateInterfaceConfig] Verification - customWelcome: ${savedCustomWelcome}, defaultEndpoint: ${savedDefaultEndpoint}, defaultModel: ${savedDefaultModel}`);
        logger.info(`Interface configuration saved and verified to ${configPath}`);
      } catch (verifyError) {
        logger.error('Error verifying config file after write:', verifyError);
        throw new Error(`File written but verification failed: ${verifyError.message}`);
      }
    } catch (error) {
      logger.error('Error writing config file:', {
        error: error.message,
        code: error.code,
        path: configPath,
        stack: error.stack,
      });
      const errorMessage = error.code === 'EACCES' 
        ? 'Permission denied: Cannot write to config file. Please check file permissions.'
        : error.code === 'ENOENT'
        ? 'Config file path does not exist.'
        : error.message || 'Failed to write config file';
      return res.status(500).json({ error: errorMessage });
    }

    // 清除缓存，强制重新加载配置
    const { getLogStores } = require('~/cache');
    const { CacheKeys } = require('@aipyq/data-provider');
    const cache = getLogStores(CacheKeys.CONFIG_STORE);
    
    // 清除所有相关缓存
    await cache.delete(CacheKeys.STARTUP_CONFIG);
    await cache.delete(CacheKeys.APP_CONFIG);
    
    // 也清除 BASE_CONFIG_KEY（如果存在）
    const BASE_CONFIG_KEY = 'base';
    await cache.delete(BASE_CONFIG_KEY);
    
    // 清除所有角色相关的缓存（如果有）
    // 注意：这里我们无法知道所有可能的角色，所以只能清除已知的缓存键
    // 实际的角色缓存会在下次请求时自动刷新
    
    logger.info('[updateInterfaceConfig] Cache cleared: STARTUP_CONFIG, APP_CONFIG, BASE_CONFIG_KEY');
    logger.info('[updateInterfaceConfig] Config saved successfully. Next request will reload from file.');

    res.json({ success: true, message: 'Interface configuration updated successfully' });
  } catch (error) {
    logger.error('Error updating interface configuration:', error);
    res.status(500).json({ error: error.message || 'Failed to update interface configuration' });
  }
}

module.exports = updateInterfaceConfig;

