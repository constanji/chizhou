import { removeNullishValues } from '@aipyq/data-provider';
import type { TCustomConfig, TConfigDefaults } from '@aipyq/data-provider';
import type { AppConfig } from '~/types/app';
import { isMemoryEnabled } from './memory';

/**
 * Loads the default interface object.
 * @param params - The loaded custom configuration.
 * @param params.config - The loaded custom configuration.
 * @param params.configDefaults - The custom configuration default values.
 * @returns default interface object.
 */
export async function loadDefaultInterface({
  config,
  configDefaults,
}: {
  config?: Partial<TCustomConfig>;
  configDefaults: TConfigDefaults;
}): Promise<AppConfig['interfaceConfig']> {
  const { interface: interfaceConfig } = config ?? {};
  const { interface: defaults } = configDefaults;
  const hasModelSpecs = (config?.modelSpecs?.list?.length ?? 0) > 0;
  const includesAddedEndpoints = (config?.modelSpecs?.addedEndpoints?.length ?? 0) > 0;

  const memoryConfig = config?.memory;
  const memoryEnabled = isMemoryEnabled(memoryConfig);
  /** Only disable memories if memory config is present but disabled/invalid */
  const shouldDisableMemories = memoryConfig && !memoryEnabled;

  // 直接从 config.interface 获取原始值（在 removeNullishValues 之前保存）
  // 这是最可靠的方式，因为 config.interface 是直接从 YAML 解析的原始数据
  const originalDefaultEndpoint = config?.interface?.defaultEndpoint;
  const originalDefaultModel = config?.interface?.defaultModel;
  const originalCustomWelcome = config?.interface?.customWelcome;
  
  // 添加日志，调试配置加载
  console.log(
    `[loadDefaultInterface] Input: originalDefaultEndpoint=${originalDefaultEndpoint}, originalDefaultModel=${originalDefaultModel}, originalCustomWelcome=${originalCustomWelcome}, interfaceConfigKeys=${interfaceConfig ? Object.keys(interfaceConfig).join(',') : 'none'}`,
  );

  const loadedInterface: AppConfig['interfaceConfig'] = removeNullishValues({
    // UI elements - use schema defaults
    endpointsMenu:
      interfaceConfig?.endpointsMenu ?? (hasModelSpecs ? false : defaults.endpointsMenu),
    modelSelect:
      interfaceConfig?.modelSelect ??
      (hasModelSpecs ? includesAddedEndpoints : defaults.modelSelect),
    parameters: interfaceConfig?.parameters ?? (hasModelSpecs ? false : defaults.parameters),
    presets: interfaceConfig?.presets ?? (hasModelSpecs ? false : defaults.presets),
    sidePanel: interfaceConfig?.sidePanel ?? defaults.sidePanel,
    privacyPolicy: interfaceConfig?.privacyPolicy ?? defaults.privacyPolicy,
    termsOfService: interfaceConfig?.termsOfService ?? defaults.termsOfService,
    mcpServers: interfaceConfig?.mcpServers ?? defaults.mcpServers,
    // 确保 customWelcome 被正确加载（即使 defaults.customWelcome 是 undefined）
    customWelcome: interfaceConfig?.customWelcome ?? defaults.customWelcome,

    // Permissions - only include if explicitly configured
    bookmarks: interfaceConfig?.bookmarks,
    memories: shouldDisableMemories ? false : interfaceConfig?.memories,
    prompts: interfaceConfig?.prompts,
    multiConvo: interfaceConfig?.multiConvo,
    agents: interfaceConfig?.agents,
    temporaryChat: interfaceConfig?.temporaryChat,
    runCode: interfaceConfig?.runCode,
    webSearch: interfaceConfig?.webSearch,
    fileSearch: interfaceConfig?.fileSearch,
    fileCitations: interfaceConfig?.fileCitations,
    peoplePicker: interfaceConfig?.peoplePicker,
    marketplace: interfaceConfig?.marketplace,
    // 注意：这里会被 removeNullishValues 移除（如果是 undefined），但我们会在后面手动添加
    defaultEndpoint: interfaceConfig?.defaultEndpoint,
    defaultModel: interfaceConfig?.defaultModel,
  });

  // 注意：removeNullishValues 会移除 undefined 和 null 值
  // 但我们需要保留这些字段（如果原始配置中有的话）
  // 所以我们在 removeNullishValues 之后，明确使用原始配置中的值来覆盖
  // 这样即使 interfaceConfig 中这些字段是 undefined，我们也能保留原始值
  const result: AppConfig['interfaceConfig'] = {
    ...loadedInterface,
    // 明确添加这些字段（如果原始配置中有值，即使是空字符串也要保留）
    // 使用 null 检查而不是 undefined，因为空字符串也是有效值
    ...(originalDefaultEndpoint != null && { defaultEndpoint: originalDefaultEndpoint }),
    ...(originalDefaultModel != null && { defaultModel: originalDefaultModel }),
    ...(originalCustomWelcome != null && { customWelcome: originalCustomWelcome }),
  };
  
  // 添加日志，调试最终结果
  console.log(
    `[loadDefaultInterface] Final: defaultEndpoint=${result.defaultEndpoint}, defaultModel=${result.defaultModel}, originalDefaultEndpoint=${originalDefaultEndpoint}, originalDefaultModel=${originalDefaultModel}, loadedInterfaceDefaultEndpoint=${loadedInterface.defaultEndpoint}, loadedInterfaceDefaultModel=${loadedInterface.defaultModel}, resultKeys=${Object.keys(result).join(',')}`,
  );

  return result;
}
