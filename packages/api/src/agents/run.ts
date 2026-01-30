import { Run, Providers } from '@aipyq/agents';
import { providerEndpointMap, KnownEndpoints } from '@aipyq/data-provider';
import { logger } from '@aipyq/data-schemas';
import type {
  MultiAgentGraphConfig,
  OpenAIClientOptions,
  StandardGraphConfig,
  AgentInputs,
  GenericTool,
  RunConfig,
  IState,
} from '@aipyq/agents';
import type { IUser } from '@aipyq/data-schemas';
import type { Agent } from '@aipyq/data-provider';
import type * as t from '~/types';
import { resolveHeaders, createSafeUser } from '~/utils/env';

const customProviders = new Set([
  Providers.XAI,
  Providers.OLLAMA,
  Providers.DEEPSEEK,
  Providers.OPENROUTER,
]);

export function getReasoningKey(
  provider: Providers,
  llmConfig: t.RunLLMConfig,
  agentEndpoint?: string | null,
): 'reasoning_content' | 'reasoning' {
  let reasoningKey: 'reasoning_content' | 'reasoning' = 'reasoning_content';
  if (provider === Providers.GOOGLE) {
    reasoningKey = 'reasoning';
  } else if (
    llmConfig.configuration?.baseURL?.includes(KnownEndpoints.openrouter) ||
    (agentEndpoint && agentEndpoint.toLowerCase().includes(KnownEndpoints.openrouter))
  ) {
    reasoningKey = 'reasoning';
  } else if (
    (llmConfig as OpenAIClientOptions).useResponsesApi === true &&
    (provider === Providers.OPENAI || provider === Providers.AZURE)
  ) {
    reasoningKey = 'reasoning';
  }
  return reasoningKey;
}

type RunAgent = Omit<Agent, 'tools'> & {
  tools?: GenericTool[];
  maxContextTokens?: number;
  useLegacyContent?: boolean;
  toolContextMap?: Record<string, string>;
};

/**
 * Creates a new Run instance with custom handlers and configuration.
 *
 * @param options - The options for creating the Run instance.
 * @param options.agents - The agents for this run.
 * @param options.signal - The signal for this run.
 * @param options.runId - Optional run ID; otherwise, a new run ID will be generated.
 * @param options.customHandlers - Custom event handlers.
 * @param options.streaming - Whether to use streaming.
 * @param options.streamUsage - Whether to stream usage information.
 * @returns {Promise<Run<IState>>} A promise that resolves to a new Run instance.
 */
export async function createRun({
  runId,
  signal,
  agents,
  requestBody,
  user,
  tokenCounter,
  customHandlers,
  indexTokenCountMap,
  streaming = true,
  streamUsage = true,
}: {
  agents: RunAgent[];
  signal: AbortSignal;
  runId?: string;
  streaming?: boolean;
  streamUsage?: boolean;
  requestBody?: t.RequestBody;
  user?: IUser;
} & Pick<RunConfig, 'tokenCounter' | 'customHandlers' | 'indexTokenCountMap'>): Promise<
  Run<IState>
> {
  const agentInputs: AgentInputs[] = [];
  const buildAgentContext = (agent: RunAgent) => {
    const provider =
      (providerEndpointMap[
        agent.provider as keyof typeof providerEndpointMap
      ] as unknown as Providers) ?? agent.provider;

    const llmConfig: t.RunLLMConfig = Object.assign(
      {
        provider,
        streaming,
        streamUsage,
      },
      agent.model_parameters,
    );

    const systemMessage = Object.values(agent.toolContextMap ?? {})
      .join('\n')
      .trim();

    const systemContent = [
      systemMessage,
      agent.instructions ?? '',
      agent.additional_instructions ?? '',
    ]
      .join('\n')
      .trim();

    /**
     * Resolve request-based headers for Custom Endpoints. Note: if this is added to
     *  non-custom endpoints, needs consideration of varying provider header configs.
     *  This is done at this step because the request body may contain dynamic values
     *  that need to be resolved after agent initialization.
     */
    if (llmConfig?.configuration?.defaultHeaders != null) {
      llmConfig.configuration.defaultHeaders = resolveHeaders({
        headers: llmConfig.configuration.defaultHeaders as Record<string, string>,
        user: createSafeUser(user),
        body: requestBody,
      });
    }

    /** Resolves issues with new OpenAI usage field */
    if (
      customProviders.has(agent.provider) ||
      (agent.provider === Providers.OPENAI && agent.endpoint !== agent.provider)
    ) {
      llmConfig.streamUsage = false;
      llmConfig.usage = true;
    }

    const reasoningKey = getReasoningKey(provider, llmConfig, agent.endpoint);
    const agentInput: AgentInputs = {
      provider,
      reasoningKey,
      agentId: agent.id,
      tools: agent.tools,
      clientOptions: llmConfig,
      instructions: systemContent,
      maxContextTokens: agent.maxContextTokens,
      useLegacyContent: agent.useLegacyContent ?? false,
    };
    agentInputs.push(agentInput);
    
    // 详细记录agent input（特别是包含speckit工具的情况）
    const hasSpeckitTool = agent.tools?.some(tool => 
      (typeof tool === 'string' && tool === 'speckit') ||
      (tool && typeof tool === 'object' && 'name' in tool && tool.name === 'speckit')
    );
    
    if (hasSpeckitTool || agentInputs.length === 1) {
      logger.info(`[Agent-Run] ========== Agent Input #${agentInputs.length} ==========`);
      
      // 记录工具信息
      const toolsInfo = agent.tools?.map((tool, index) => {
        if (typeof tool === 'string') {
          return { index, type: 'string_reference', name: tool };
        }
        if (tool && typeof tool === 'object') {
          return {
            index,
            type: 'object',
            name: 'name' in tool ? tool.name : 'unknown',
            description: 'description' in tool ? (typeof tool.description === 'string' ? tool.description.substring(0, 200) : tool.description) : undefined,
            schema: 'schema' in tool ? JSON.stringify(tool.schema, null, 2).substring(0, 1000) : undefined,
          };
        }
        return { index, type: 'unknown', tool };
      }) || [];
      
      const agentInputLog = {
        agentId: agent.id,
        agentName: 'name' in agent ? agent.name : undefined,
        provider,
        reasoningKey,
        model: llmConfig?.model,
        clientOptions: {
          ...llmConfig,
          // 移除敏感信息（如果存在）
          ...('apiKey' in llmConfig && llmConfig.apiKey ? { apiKey: '[REDACTED]' } : {}),
          configuration: llmConfig?.configuration ? {
            ...llmConfig.configuration,
            ...('apiKey' in llmConfig.configuration && llmConfig.configuration.apiKey ? { apiKey: '[REDACTED]' } : {}),
          } : undefined,
        },
        tools: {
          count: agent.tools?.length || 0,
          tools: toolsInfo,
          hasSpeckit: hasSpeckitTool,
        },
        instructions: {
          systemMessage: systemMessage.substring(0, 500) + (systemMessage.length > 500 ? '...' : ''),
          instructions: agent.instructions?.substring(0, 500) + (agent.instructions && agent.instructions.length > 500 ? '...' : ''),
          additionalInstructions: agent.additional_instructions?.substring(0, 500) + (agent.additional_instructions && agent.additional_instructions.length > 500 ? '...' : ''),
          combinedSystemContent: systemContent.substring(0, 1000) + (systemContent.length > 1000 ? '...' : ''),
        },
        maxContextTokens: agent.maxContextTokens,
        useLegacyContent: agent.useLegacyContent ?? false,
        toolContextMap: agent.toolContextMap ? Object.keys(agent.toolContextMap) : undefined,
        edges: 'edges' in agent ? agent.edges : undefined,
      };
      
      logger.info(`[Agent-Run] Agent Input详情: ${JSON.stringify(agentInputLog, null, 2)}`);
      logger.info(`[Agent-Run] ========== Agent Input #${agentInputs.length} 记录完成 ==========`);
    }
  };

  for (const agent of agents) {
    buildAgentContext(agent);
  }

  const graphConfig: RunConfig['graphConfig'] = {
    signal,
    agents: agentInputs,
    edges: agents[0].edges,
  };

  if (agentInputs.length > 1 || ((graphConfig as MultiAgentGraphConfig).edges?.length ?? 0) > 0) {
    (graphConfig as unknown as MultiAgentGraphConfig).type = 'multi-agent';
  } else {
    (graphConfig as StandardGraphConfig).type = 'standard';
  }

  // 记录完整的graphConfig（特别是包含speckit工具的情况）
  const hasSpeckitInAnyAgent = agentInputs.some(input => 
    input.tools?.some(tool => 
      (typeof tool === 'string' && tool === 'speckit') ||
      (tool && typeof tool === 'object' && 'name' in tool && tool.name === 'speckit')
    )
  );
  
  if (hasSpeckitInAnyAgent || agentInputs.length > 0) {
    logger.info(`[Agent-Run] ========== Graph Config ==========`);
    const graphConfigLog = {
      runId,
      type: (graphConfig as MultiAgentGraphConfig).type || (graphConfig as StandardGraphConfig).type,
      agentCount: agentInputs.length,
      agents: agentInputs.map((input, index) => ({
        index: index + 1,
        agentId: input.agentId,
        provider: input.provider,
        reasoningKey: input.reasoningKey,
        toolsCount: input.tools?.length || 0,
        tools: input.tools?.map(tool => 
          typeof tool === 'string' ? tool : (tool && typeof tool === 'object' && 'name' in tool ? tool.name : 'unknown')
        ),
        hasSpeckit: input.tools?.some(tool => 
          (typeof tool === 'string' && tool === 'speckit') ||
          (tool && typeof tool === 'object' && 'name' in tool && tool.name === 'speckit')
        ),
        instructionsLength: input.instructions?.length || 0,
        maxContextTokens: input.maxContextTokens,
        useLegacyContent: input.useLegacyContent,
      })),
      edges: (graphConfig as MultiAgentGraphConfig).edges || undefined,
      hasSignal: !!signal,
      streaming,
      streamUsage,
    };
    logger.info(`[Agent-Run] Graph Config详情: ${JSON.stringify(graphConfigLog, null, 2)}`);
    logger.info(`[Agent-Run] ========== Graph Config 记录完成 ==========`);
  }

  return Run.create({
    runId,
    graphConfig,
    tokenCounter,
    customHandlers,
    indexTokenCountMap,
  });
}
