import React, { useMemo } from 'react';
import { getEndpointField, Constants } from '@aipyq/data-provider';
import type * as t from '@aipyq/data-provider';
import { getIconKey, getEntity, getIconEndpoint } from '~/utils';
import ConvoIconURL from '~/components/Endpoints/ConvoIconURL';
import { icons } from '~/hooks/Endpoint/Icons';

export default function ConvoIcon({
  conversation,
  endpointsConfig,
  assistantMap,
  agentsMap,
  className = '',
  containerClassName = '',
  context,
  size,
}: {
  conversation: t.TConversation | t.TPreset | null;
  endpointsConfig: t.TEndpointsConfig;
  assistantMap: t.TAssistantsMap | undefined;
  agentsMap: t.TAgentsMap | undefined;
  containerClassName?: string;
  context?: 'message' | 'nav' | 'landing' | 'menu-item';
  className?: string;
  size?: number;
}) {
  const iconURL = conversation?.iconURL ?? '';
  const originalEndpoint = conversation?.endpoint;
  let endpoint = originalEndpoint;
  endpoint = getIconEndpoint({ endpointsConfig, iconURL, endpoint });

  const { entity, isAgent } = useMemo(
    () =>
      getEntity({
        endpoint,
        agentsMap,
        assistantMap,
        agent_id: conversation?.agent_id,
        assistant_id: conversation?.assistant_id,
      }),
    [endpoint, conversation?.agent_id, conversation?.assistant_id, agentsMap, assistantMap],
  );

  const name = entity?.name ?? '';
  const avatar = isAgent
    ? (entity as t.Agent | undefined)?.avatar?.filepath
    : ((entity as t.Assistant | undefined)?.metadata?.avatar as string);

  const endpointIconURL = getEndpointField(endpointsConfig, endpoint, 'iconURL');
  const iconKey = getIconKey({ endpoint, endpointsConfig, endpointIconURL });
  const Icon = icons[iconKey] ?? null;

  // 如果没有选择模型和agent，默认显示SVG logo
  // 在landing页面（新对话），显示logo.svg，不显示具体模型图标
  // 即使系统设置了默认模型，只要是新对话，就显示logo.svg
  const defaultLogoURL = 'assets/logo.svg';
  const hasNoAgent = !conversation?.agent_id;
  const hasNoAssistant = !conversation?.assistant_id;
  // 检查是否是新对话（landing页面）
  const isNewConversation = conversation?.conversationId === Constants.NEW_CONVO;
  // 在landing页面（新对话），显示默认logo，不显示具体模型图标
  const shouldShowDefaultLogo = 
    context === 'landing' && 
    isNewConversation &&
    hasNoAgent && 
    hasNoAssistant && 
    !iconURL;

  return (
    <>
      {shouldShowDefaultLogo ? (
        <ConvoIconURL
          iconURL={defaultLogoURL}
          modelLabel={conversation?.chatGptLabel ?? conversation?.modelLabel ?? ''}
          endpointIconURL={endpointIconURL}
          assistantAvatar={avatar}
          assistantName={name}
          agentAvatar={avatar}
          agentName={name}
          context={context}
        />
      ) : iconURL && iconURL.includes('http') ? (
        <ConvoIconURL
          iconURL={iconURL}
          modelLabel={conversation?.chatGptLabel ?? conversation?.modelLabel ?? ''}
          endpointIconURL={endpointIconURL}
          assistantAvatar={avatar}
          assistantName={name}
          agentAvatar={avatar}
          agentName={name}
          context={context}
        />
      ) : (
        <div className={containerClassName}>
          {endpoint && Icon != null && (
            <Icon
              size={size}
              context={context}
              endpoint={endpoint}
              className={className}
              iconURL={endpointIconURL}
              assistantName={name}
              agentName={name}
              avatar={avatar}
            />
          )}
        </div>
      )}
    </>
  );
}
