import { useEffect, useState, useRef } from 'react';
import { useChatContext } from '~/Providers';
import { extractToolCallsByMessage } from '~/utils/parseDatServerResponse';
import type { MessageToolCalls } from '~/utils/parseDatServerResponse';

/**
 * Hook 从当前消息中提取所有工具调用（按消息分组）
 * 返回按消息分组的工具调用数组，用于展示思维链
 */
export function useToolCallsWithThoughtChains(): {
  toolCallsByMessage: MessageToolCalls[];
} {
  const { getMessages } = useChatContext();
  const [toolCallsByMessage, setToolCallsByMessage] = useState<MessageToolCalls[]>([]);
  const lastMessagesRef = useRef<string>('');
  const lastToolCallsByMessageHashRef = useRef<string>('');

  // 用于检测工具调用的消息更新轮询
  useEffect(() => {
    const checkMessages = () => {
      try {
        const messages = getMessages();
        if (!messages || messages.length === 0) {
          if (toolCallsByMessage.length > 0) {
            setToolCallsByMessage([]);
            lastToolCallsByMessageHashRef.current = '';
            lastMessagesRef.current = '';
          }
          return;
        }

        // 创建消息的简单哈希来检测变化（避免不必要的解析）
        const messagesHash = JSON.stringify(
          messages.map((m: any) => ({
            id: m.messageId,
            contentLength: m.content?.length || 0,
            lastContentType: m.content?.[m.content.length - 1]?.type,
            unfinished: m.unfinished,
          })),
        );

        // 如果消息没有变化，跳过解析
        if (messagesHash === lastMessagesRef.current) {
          return;
        }

        lastMessagesRef.current = messagesHash;

        const extracted = extractToolCallsByMessage(messages);

        // 只在工具调用数据真正变化时更新状态
        const extractedHash = JSON.stringify(
          extracted.map((item) => ({
            messageId: item.messageId,
            messageIndex: item.messageIndex,
            toolCount: item.toolCalls.length,
            isStreaming: item.isStreaming,
          })),
        );

        if (extractedHash !== lastToolCallsByMessageHashRef.current) {
          lastToolCallsByMessageHashRef.current = extractedHash;
          setToolCallsByMessage(extracted);
        }
      } catch (error) {
        console.warn('Error extracting tool calls:', error);
        if (toolCallsByMessage.length > 0) {
          setToolCallsByMessage([]);
          lastToolCallsByMessageHashRef.current = '';
          lastMessagesRef.current = '';
        }
      }
    };

    // 立刻检查
    checkMessages();

    // 增加轮询间隔到 1 秒，减少不必要的检查
    const interval = setInterval(checkMessages, 1000);

    return () => clearInterval(interval);
  }, [getMessages, toolCallsByMessage.length]);

  return {
    toolCallsByMessage,
  };
}

