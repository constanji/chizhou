import type {
  TPreset,
  TConversation,
  EModelEndpoint,
  TEndpointsConfig,
  TStartupConfig,
} from '@aipyq/data-provider';
import { isAgentsEndpoint } from '@aipyq/data-provider';
import { getLocalStorageItems } from './localStorage';
import { mapEndpoints } from './endpoints';

type TConvoSetup = Partial<TPreset> | Partial<TConversation>;

type TDefaultEndpoint = { 
  convoSetup: TConvoSetup; 
  endpointsConfig: TEndpointsConfig;
  startupConfig?: TStartupConfig;
};

const getEndpointFromSetup = (
  convoSetup: TConvoSetup | null,
  endpointsConfig: TEndpointsConfig,
): EModelEndpoint | null => {
  let { endpoint: targetEndpoint = '' } = convoSetup || {};
  targetEndpoint = targetEndpoint ?? '';
  if (targetEndpoint && endpointsConfig?.[targetEndpoint]) {
    return targetEndpoint as EModelEndpoint;
  } else if (targetEndpoint) {
    console.warn(`Illegal target endpoint ${targetEndpoint}`, endpointsConfig);
  }
  return null;
};

const getEndpointFromLocalStorage = (endpointsConfig: TEndpointsConfig) => {
  try {
    const { lastConversationSetup } = getLocalStorageItems();
    const { endpoint } = lastConversationSetup ?? { endpoint: null };
    const isDefaultConfig = Object.values(endpointsConfig ?? {}).every((value) => !value);

    if (isDefaultConfig && endpoint) {
      return endpoint;
    }

    if (isDefaultConfig && endpoint) {
      return endpoint;
    }

    return endpoint && endpointsConfig?.[endpoint] != null ? endpoint : null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

// 从配置中获取默认端点
const getEndpointFromConfig = (startupConfig?: TStartupConfig, endpointsConfig?: TEndpointsConfig): EModelEndpoint | null => {
  const defaultEndpoint = startupConfig?.interface?.defaultEndpoint;
  console.log('[getDefaultEndpoint] getEndpointFromConfig:', {
    defaultEndpoint,
    hasEndpointInConfig: defaultEndpoint && endpointsConfig?.[defaultEndpoint],
    availableEndpoints: Object.keys(endpointsConfig ?? {}),
  });
  
  if (!defaultEndpoint) {
    return null;
  }
  
  // 首先检查是否是标准端点
  if (endpointsConfig?.[defaultEndpoint]) {
    return defaultEndpoint as EModelEndpoint;
  }
  
  // 如果不是标准端点，可能是自定义端点，检查所有可用端点（包括自定义端点）
  // 自定义端点会被映射到 endpointsConfig 中，键名是规范化后的端点名称
  const allEndpoints = mapEndpoints(endpointsConfig ?? {});
  const foundEndpoint = allEndpoints.find((ep) => {
    // 支持精确匹配和不区分大小写的匹配
    return ep === defaultEndpoint || 
           ep.toLowerCase() === defaultEndpoint.toLowerCase() ||
           ep === defaultEndpoint.toLowerCase() ||
           ep.toLowerCase() === defaultEndpoint;
  });
  
  if (foundEndpoint) {
    console.log('[getDefaultEndpoint] Found custom endpoint:', foundEndpoint);
    return foundEndpoint as EModelEndpoint;
  }
  
  return null;
};

const getDefinedEndpoint = (endpointsConfig: TEndpointsConfig) => {
  const endpoints = mapEndpoints(endpointsConfig);
  return endpoints.find((e) => {
    return Object.hasOwn(endpointsConfig ?? {}, e);
  });
};

const getDefaultEndpoint = ({
  convoSetup,
  endpointsConfig,
  startupConfig,
}: TDefaultEndpoint): EModelEndpoint | undefined => {
  // 优先级：
  // 1. 从对话设置中获取（如果明确指定）
  // 2. 从配置的默认端点获取（最高优先级，确保配置生效）
  // 3. 从本地存储获取（优先级低于配置）
  // 4. 从定义的端点中获取（排除agents端点）
  
  const fromSetup = getEndpointFromSetup(convoSetup, endpointsConfig);
  const configDefaultEndpoint = startupConfig?.interface?.defaultEndpoint;
  
  // 添加更详细的调试信息
  const interfaceObj = startupConfig?.interface;
  console.log('[getDefaultEndpoint] Checking endpoint sources:', {
    fromSetup,
    configDefaultEndpoint,
    hasStartupConfig: !!startupConfig,
    hasInterface: !!interfaceObj,
    startupConfigInterface: interfaceObj,
    interfaceKeys: interfaceObj ? Object.keys(interfaceObj) : [],
    defaultEndpointValue: interfaceObj?.defaultEndpoint,
    defaultModelValue: interfaceObj?.defaultModel,
    // 直接检查对象属性
    'interfaceObj?.defaultEndpoint': interfaceObj?.defaultEndpoint,
    'interfaceObj?.defaultModel': interfaceObj?.defaultModel,
    // 检查所有属性
    fullInterfaceObj: JSON.stringify(interfaceObj, null, 2),
  });
  
  // 如果明确从对话设置中获取到端点，使用它
  if (fromSetup) {
    console.log('[getDefaultEndpoint] Using endpoint from setup:', fromSetup);
    return fromSetup;
  }

  // 优先使用配置的默认端点（确保新用户和已有用户都使用配置的值）
  const fromConfig = getEndpointFromConfig(startupConfig, endpointsConfig);
  if (fromConfig) {
    console.log('[getDefaultEndpoint] Using endpoint from config:', fromConfig);
    return fromConfig;
  }

  // 只有在没有配置默认端点时，才使用本地存储的值
  // 但需要确保不会错误地使用 agents 端点（除非配置的就是 agents）
  const fromStorage = getEndpointFromLocalStorage(endpointsConfig);
  if (fromStorage) {
    // 如果配置了默认端点但不是 agents，而存储的是 agents，跳过它
    if (configDefaultEndpoint && configDefaultEndpoint !== 'agents' && isAgentsEndpoint(fromStorage)) {
      console.log('[getDefaultEndpoint] Skipping agents endpoint from storage (config default is not agents)');
    } else {
      console.log('[getDefaultEndpoint] Using endpoint from storage:', fromStorage);
      return fromStorage;
    }
  }

  // 最后，从定义的端点中获取，但排除 agents（除非配置的就是 agents）
  const definedEndpoint = getDefinedEndpoint(endpointsConfig);
  if (definedEndpoint && configDefaultEndpoint && configDefaultEndpoint !== 'agents' && isAgentsEndpoint(definedEndpoint)) {
    console.log('[getDefaultEndpoint] Skipping agents endpoint (config default is not agents)');
    // 继续查找其他端点
    const endpoints = mapEndpoints(endpointsConfig);
    const filteredEndpoints = endpoints.filter((e) => {
      if (isAgentsEndpoint(e)) return false;
      return Object.hasOwn(endpointsConfig ?? {}, e);
    });
    const fallbackEndpoint = filteredEndpoints[0];
    console.log('[getDefaultEndpoint] Using fallback endpoint:', fallbackEndpoint);
    return fallbackEndpoint;
  }
  
  console.log('[getDefaultEndpoint] Using defined endpoint:', definedEndpoint);
  return definedEndpoint;
};

export default getDefaultEndpoint;
