const { Providers } = require('@aipyq/agents');
const { EModelEndpoint, normalizeEndpointName } = require('@aipyq/data-provider');
const { getCustomEndpointConfig } = require('@aipyq/api');
const initAnthropic = require('~/server/services/Endpoints/anthropic/initialize');
const getBedrockOptions = require('~/server/services/Endpoints/bedrock/options');
const initOpenAI = require('~/server/services/Endpoints/openAI/initialize');
const initCustom = require('~/server/services/Endpoints/custom/initialize');
const initGoogle = require('~/server/services/Endpoints/google/initialize');

/** Check if the provider is a known custom provider
 * @param {string | undefined} [provider] - The provider string
 * @returns {boolean} - True if the provider is a known custom provider, false otherwise
 */
function isKnownCustomProvider(provider) {
  return [Providers.XAI, Providers.OLLAMA, Providers.DEEPSEEK, Providers.OPENROUTER].includes(
    provider?.toLowerCase() || '',
  );
}

const providerConfigMap = {
  [Providers.XAI]: initCustom,
  [Providers.OLLAMA]: initCustom,
  [Providers.DEEPSEEK]: initCustom,
  [Providers.OPENROUTER]: initCustom,
  [EModelEndpoint.openAI]: initOpenAI,
  [EModelEndpoint.google]: initGoogle,
  [EModelEndpoint.azureOpenAI]: initOpenAI,
  [EModelEndpoint.anthropic]: initAnthropic,
  [EModelEndpoint.bedrock]: getBedrockOptions,
};

/**
 * Get the provider configuration and override endpoint based on the provider string
 * @param {Object} params
 * @param {string} params.provider - The provider string
 * @param {AppConfig} params.appConfig - The application configuration
 * @returns {{
 * getOptions: (typeof providerConfigMap)[keyof typeof providerConfigMap],
 * overrideProvider: string,
 * customEndpointConfig?: TEndpoint
 * }}
 */
function getProviderConfig({ provider, appConfig }) {
  let getOptions = providerConfigMap[provider];
  let overrideProvider = provider;
  /** @type {TEndpoint | undefined} */
  let customEndpointConfig;

  if (!getOptions && providerConfigMap[provider.toLowerCase()] != null) {
    overrideProvider = provider.toLowerCase();
    getOptions = providerConfigMap[overrideProvider];
  } else if (!getOptions) {
    customEndpointConfig = getCustomEndpointConfig({ endpoint: provider, appConfig });
    if (!customEndpointConfig) {
      throw new Error(`Provider ${provider} not supported`);
    }
    getOptions = initCustom;
    overrideProvider = Providers.OPENAI;
  }

  if (isKnownCustomProvider(overrideProvider) && !customEndpointConfig) {
    // Try to find the custom endpoint config by provider name
    // Provider names are case-insensitive, so normalize for comparison
    const normalizedProvider = normalizeEndpointName(overrideProvider);
    const lowerProvider = overrideProvider.toLowerCase();
    
    // Try multiple ways to find the endpoint config
    customEndpointConfig = getCustomEndpointConfig({ endpoint: overrideProvider, appConfig });
    if (!customEndpointConfig) {
      customEndpointConfig = getCustomEndpointConfig({ endpoint: normalizedProvider, appConfig });
    }
    if (!customEndpointConfig) {
      customEndpointConfig = getCustomEndpointConfig({ endpoint: lowerProvider, appConfig });
    }
    
    // If still not found, try searching in custom endpoints array directly
    if (!customEndpointConfig && appConfig?.endpoints?.[EModelEndpoint.custom]) {
      const customEndpoints = appConfig.endpoints[EModelEndpoint.custom];
      customEndpointConfig = customEndpoints.find(
        (ep) => {
          const normalizedEpName = normalizeEndpointName(ep.name);
          const lowerEpName = ep.name?.toLowerCase();
          return normalizedEpName === normalizedProvider ||
                 normalizedEpName === lowerProvider ||
                 lowerEpName === normalizedProvider ||
                 lowerEpName === lowerProvider;
        }
      );
    }
    
    if (!customEndpointConfig) {
      throw new Error(`Provider ${provider} not supported. Please ensure a custom endpoint named "${overrideProvider}" (or "${normalizedProvider}") is configured in your Aipyq.yaml file.`);
    }
  }

  return {
    getOptions,
    overrideProvider,
    customEndpointConfig,
  };
}

module.exports = {
  getProviderConfig,
};
