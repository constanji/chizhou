import { ContentTypes } from '@aipyq/data-provider';
import type { TMessage, TMessageContentParts } from '@aipyq/data-provider';

/**
 * 单个工具调用的结构（与服务端/消息 content 中的 tool_call 一致）
 */
export interface ToolCallItem {
  name: string;
  args: string | Record<string, unknown>;
  output?: string | null;
  progress?: number;
  id?: string;
  auth?: string;
  expires_at?: number;
}

/**
 * 按消息分组的工具调用（用于思维链展示）
 */
export interface MessageToolCalls {
  messageId: string;
  messageIndex: number;
  toolCalls: ToolCallItem[];
  isStreaming?: boolean;
}

/**
 * 消息 content 中的单项（与 TMessageContentParts 兼容）
 */
export type MessageContentItem = TMessageContentParts;

/**
 * 从消息列表中按消息提取所有工具调用（按消息分组）
 * 用于思维链面板等需要按消息展示工具调用的场景
 */
export function extractToolCallsByMessage(messages: TMessage[]): MessageToolCalls[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const result: MessageToolCalls[] = [];

  messages.forEach((message, messageIndex) => {
    const content = message?.content;
    if (!content || !Array.isArray(content)) {
      return;
    }

    const toolCalls: ToolCallItem[] = [];

    content.forEach((part: TMessageContentParts | undefined) => {
      if (!part || part.type !== ContentTypes.TOOL_CALL) {
        return;
      }
      const raw = part[ContentTypes.TOOL_CALL] as Record<string, unknown> | undefined;
      if (!raw) {
        return;
      }
      const name = typeof raw.name === 'string' ? raw.name : '';
      const args =
        typeof raw.args === 'string'
          ? raw.args
          : typeof raw.args === 'object' && raw.args !== null
            ? (raw.args as Record<string, unknown>)
            : '';
      const output =
        raw.output === undefined || raw.output === null
          ? undefined
          : typeof raw.output === 'string'
            ? raw.output
            : String(raw.output);
      toolCalls.push({
        name,
        args,
        output: output ?? undefined,
        progress: typeof raw.progress === 'number' ? raw.progress : undefined,
        id: typeof raw.id === 'string' ? raw.id : undefined,
        auth: typeof raw.auth === 'string' ? raw.auth : undefined,
        expires_at: typeof raw.expires_at === 'number' ? raw.expires_at : undefined,
      });
    });

    if (toolCalls.length > 0) {
      result.push({
        messageId: message.messageId ?? '',
        messageIndex,
        toolCalls,
        isStreaming: message.unfinished === true,
      });
    }
  });

  return result;
}
