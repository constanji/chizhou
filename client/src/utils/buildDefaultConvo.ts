import {
  parseConvo,
  EModelEndpoint,
  isAssistantsEndpoint,
  isAgentsEndpoint,
} from '@aipyq/data-provider';
import type { TConversation, EndpointSchemaKey, TStartupConfig } from '@aipyq/data-provider';
import { getLocalStorageItems } from './localStorage';

const buildDefaultConvo = ({
  models,
  conversation,
  endpoint = null,
  lastConversationSetup,
  startupConfig,
}: {
  models: string[];
  conversation: TConversation;
  endpoint?: EModelEndpoint | null;
  lastConversationSetup: TConversation | null;
  startupConfig?: TStartupConfig;
}): TConversation => {
  const { lastSelectedModel, lastSelectedTools } = getLocalStorageItems();
  const endpointType = lastConversationSetup?.endpointType ?? conversation.endpointType;

  if (!endpoint) {
    return {
      ...conversation,
      endpointType,
      endpoint,
    };
  }

  const availableModels = models;
  // 优先级：配置的默认模型 > lastConversationSetup > lastSelectedModel
  const configDefaultModel = startupConfig?.interface?.defaultEndpoint === endpoint 
    ? startupConfig?.interface?.defaultModel 
    : undefined;
  
  console.log('[buildDefaultConvo] Building default conversation:', {
    endpoint,
    configDefaultEndpoint: startupConfig?.interface?.defaultEndpoint,
    configDefaultModel,
    lastConversationSetupModel: lastConversationSetup?.model,
    lastSelectedModel: lastSelectedModel?.[endpoint],
    availableModels,
  });
  
  // 确定要使用的模型
  // 优先级：配置的默认模型 > lastConversationSetup > lastSelectedModel > 第一个可用模型
  let selectedModel: string | undefined = undefined;
  if (configDefaultModel && availableModels.includes(configDefaultModel)) {
    selectedModel = configDefaultModel;
    console.log('[buildDefaultConvo] Using model from config:', selectedModel);
  } else if (lastConversationSetup?.model && availableModels.includes(lastConversationSetup.model)) {
    selectedModel = lastConversationSetup.model;
    console.log('[buildDefaultConvo] Using model from lastConversationSetup:', selectedModel);
  } else if (lastSelectedModel?.[endpoint] && availableModels.includes(lastSelectedModel[endpoint])) {
    selectedModel = lastSelectedModel[endpoint];
    console.log('[buildDefaultConvo] Using model from lastSelectedModel:', selectedModel);
  } else if (availableModels.length > 0) {
    selectedModel = availableModels[0];
    console.log('[buildDefaultConvo] Using first available model:', selectedModel);
  } else {
    console.log('[buildDefaultConvo] No available models found');
  }
  
  const secondaryModel: string | null =
    endpoint === EModelEndpoint.gptPlugins
      ? (lastConversationSetup?.agentOptions?.model ?? lastSelectedModel?.secondaryModel ?? null)
      : null;

  let possibleModels: string[], secondaryModels: string[];

  // 确保选中的模型在可用模型列表的第一位
  if (selectedModel && availableModels.includes(selectedModel)) {
    possibleModels = [selectedModel, ...availableModels.filter(m => m !== selectedModel)];
  } else {
    possibleModels = [...availableModels];
  }

  if (secondaryModel != null && secondaryModel !== '' && availableModels.includes(secondaryModel)) {
    secondaryModels = [secondaryModel, ...availableModels.filter(m => m !== secondaryModel)];
  } else {
    secondaryModels = [...availableModels];
  }

  // 创建一个新的对话对象，确保默认模型被正确设置
  const conversationWithModel = lastConversationSetup 
    ? { ...lastConversationSetup }
    : { ...conversation };
  
  // 如果确定了要使用的模型，设置到对话对象中
  // 这样 parseConvo 就不会用 models 数组的第一个值覆盖它
  if (selectedModel) {
    conversationWithModel.model = selectedModel;
  }

  const convo = parseConvo({
    endpoint: endpoint as EndpointSchemaKey,
    endpointType: endpointType as EndpointSchemaKey,
    conversation: conversationWithModel,
    possibleValues: {
      models: possibleModels,
      secondaryModels,
    },
  });

  const defaultConvo = {
    ...conversation,
    ...convo,
    endpointType,
    endpoint,
  };

  // Ensures assistant_id is always defined
  const assistantId = convo?.assistant_id ?? conversation?.assistant_id ?? '';
  const defaultAssistantId = lastConversationSetup?.assistant_id ?? '';
  if (isAssistantsEndpoint(endpoint) && !defaultAssistantId && assistantId) {
    defaultConvo.assistant_id = assistantId;
  }

  // Ensures agent_id is always defined
  const agentId = convo?.agent_id ?? '';
  const defaultAgentId = lastConversationSetup?.agent_id ?? '';
  if (isAgentsEndpoint(endpoint) && !defaultAgentId && agentId) {
    defaultConvo.agent_id = agentId;
  }

  defaultConvo.tools = lastConversationSetup?.tools ?? lastSelectedTools ?? defaultConvo.tools;

  return defaultConvo;
};

export default buildDefaultConvo;
