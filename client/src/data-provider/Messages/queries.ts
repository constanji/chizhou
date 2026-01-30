import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import { QueryKeys, dataService, Constants } from '@aipyq/data-provider';
import type * as t from '@aipyq/data-provider';
import { logger } from '~/utils';

export const useGetMessagesByConvoId = <TData = t.TMessage[]>(
  id: string,
  config?: UseQueryOptions<t.TMessage[], unknown, TData>,
): QueryObserverResult<TData> => {
  const location = useLocation();
  const queryClient = useQueryClient();
  return useQuery<t.TMessage[], unknown, TData>(
    [QueryKeys.messages, id],
    async () => {
      try {
        const result = await dataService.getMessagesByConvoId(id);
        if (!location.pathname.includes('/c/new') && result?.length === 1) {
          const currentMessages = queryClient.getQueryData<t.TMessage[]>([QueryKeys.messages, id]);
          if (currentMessages?.length === 1) {
            return result;
          }
          if (currentMessages && currentMessages?.length > 1) {
            logger.warn(
              'messages',
              `Messages query for convo ${id} returned fewer than cache; path: "${location.pathname}"`,
              result,
              currentMessages,
            );
            return currentMessages;
          }
        }
        return result;
      } catch (error: any) {
        // 处理404错误：对话不存在时返回空数组
        if (error?.response?.status === 404) {
          // 对于新建对话、临时对话（以_开头）或当前路径是新建对话页面，使用debug级别
          // 这样可以避免在新建对话时显示不必要的警告
          const isNewOrTemporary = 
            id === Constants.NEW_CONVO || 
            id?.startsWith('_') || 
            location.pathname.includes('/c/new');
          
          if (isNewOrTemporary) {
            // 新建对话或临时对话的404是正常的，使用debug级别
            logger.debug('messages', `Conversation ${id} not found (404), returning empty array (new/temporary conversation)`);
          } else {
            // 已存在的对话返回404可能是异常情况，保留警告
            logger.warn('messages', `Conversation ${id} not found (404), returning empty array`);
          }
          return [] as t.TMessage[];
        }
        throw error;
      }
    },
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: (failureCount, error: any) => {
        // 404错误不重试
        if (error?.response?.status === 404) {
          return false;
        }
        return failureCount < 2;
      },
      ...config,
    },
  );
};
