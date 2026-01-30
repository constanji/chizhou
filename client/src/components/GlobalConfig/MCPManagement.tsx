import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Button, useToastContext } from '@aipyq/client';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from '@aipyq/data-provider';
import { useReinitializeMCPServerMutation } from '@aipyq/data-provider/react-query';
import type { TStartupConfig } from '@aipyq/data-provider';
import { useLocalize, useMCPConnectionStatus, useAuthContext } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { cn } from '~/utils';
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertCircle, Plus, Edit, Trash2, List, Grid } from 'lucide-react';
import MCPConfigEditor from './MCPConfigEditor';

interface MCPManagementProps {
  startupConfig?: TStartupConfig;
}

interface ServerTestingState {
  [serverName: string]: boolean;
}

interface MCPServerConfig {
  serverName: string;
  config: {
    type?: string;
    url?: string;
    chatMenu?: boolean;
    startup?: boolean;
    customUserVars?: Record<string, any>;
    [key: string]: any;
  };
}

export default function MCPManagement({ startupConfig: propStartupConfig }: MCPManagementProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: startupConfigFromQuery, refetch } = useGetStartupConfig();
  const startupConfig = propStartupConfig || startupConfigFromQuery;
  const { connectionStatus, refetch: refetchConnectionStatus } = useMCPConnectionStatus({
    enabled: true, // 始终启用，以便自动获取连接状态
  });

  const [testingServers, setTestingServers] = useState<ServerTestingState>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [customServers, setCustomServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [serverErrorMessages, setServerErrorMessages] = useState<Record<string, string>>({});
  const isRestoringScrollRef = useRef(false);
  const savedScrollPositionRef = useRef<number | null>(null);
  const lastTestTimeRef = useRef<number>(0);

  const reinitializeMutation = useReinitializeMCPServerMutation();

  // 恢复滚动位置的辅助函数
  const restoreScrollPosition = useCallback((position: number) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    
    isRestoringScrollRef.current = true;
    savedScrollPositionRef.current = position;
    
    // 立即尝试恢复
    scrollContainer.scrollTop = position;
    
    let lastUserScrollTime = Date.now();
    let isUserScrolling = false;
    
    // 监听用户滚动，如果用户主动滚动，停止恢复
    const handleUserScroll = () => {
      lastUserScrollTime = Date.now();
      isUserScrolling = true;
    };
    
    scrollContainer.addEventListener('scroll', handleUserScroll, { passive: true });
    
    // 使用 MutationObserver 监听 DOM 变化，只在 DOM 更新导致滚动重置时恢复
    const mutationObserver = new MutationObserver(() => {
      if (!isRestoringScrollRef.current || savedScrollPositionRef.current !== position) {
        return;
      }
      
      // 如果用户最近滚动过（500ms内），不恢复
      if (Date.now() - lastUserScrollTime < 500) {
        return;
      }
      
      const container = scrollContainerRef.current;
      if (container) {
        const currentScroll = container.scrollTop;
        // 只有当滚动位置被重置到接近顶部时才恢复
        if (currentScroll < position - 10) {
          container.scrollTop = position;
        }
      }
    });
    
    // 监听滚动容器的子元素变化
    mutationObserver.observe(scrollContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    
    // 定期检查并恢复，但只在非用户滚动时
    const restoreInterval = setInterval(() => {
      if (!isRestoringScrollRef.current || savedScrollPositionRef.current !== position) {
        clearInterval(restoreInterval);
        mutationObserver.disconnect();
        scrollContainer.removeEventListener('scroll', handleUserScroll);
        return;
      }
      
      // 如果用户最近滚动过，不恢复
      if (Date.now() - lastUserScrollTime < 500) {
        isUserScrolling = false;
        return;
      }
      
      const container = scrollContainerRef.current;
      if (container) {
        const currentScroll = container.scrollTop;
        // 只有当滚动位置被重置到接近顶部时才恢复
        if (currentScroll < position - 10) {
          container.scrollTop = position;
        } else {
          // 如果滚动位置已经稳定，提前结束恢复
          if (Math.abs(currentScroll - position) <= 1) {
            clearInterval(restoreInterval);
            mutationObserver.disconnect();
            scrollContainer.removeEventListener('scroll', handleUserScroll);
            isRestoringScrollRef.current = false;
            savedScrollPositionRef.current = null;
          }
        }
      }
    }, 100);
    
    // 延长恢复时间到8秒，因为数据刷新可能需要更长时间
    // 但只在检测到滚动位置被重置时才恢复，不会阻止用户滚动
    setTimeout(() => {
      clearInterval(restoreInterval);
      mutationObserver.disconnect();
      scrollContainer.removeEventListener('scroll', handleUserScroll);
      // 延迟清除标志，确保最后一次恢复完成
      setTimeout(() => {
        if (isRestoringScrollRef.current && savedScrollPositionRef.current === position) {
          isRestoringScrollRef.current = false;
          savedScrollPositionRef.current = null;
        }
      }, 1000);
    }, 8000);
    
    // 立即验证并重试几次
    const verifyAndRetry = (attempt = 0) => {
      if (attempt >= 10) {
        return;
      }
      
      const container = scrollContainerRef.current;
      if (!container) return;
      
      const currentScroll = container.scrollTop;
      // 只有当滚动位置被重置到接近顶部时才恢复
      if (currentScroll < position - 10) {
        container.scrollTop = position;
        setTimeout(() => verifyAndRetry(attempt + 1), 50);
      }
    };
    
    // 使用 requestAnimationFrame 确保在渲染后验证
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        verifyAndRetry();
      });
    });
  }, []);

  // 使用 useLayoutEffect 在 DOM 更新后立即恢复滚动位置
  useLayoutEffect(() => {
    if (isRestoringScrollRef.current && savedScrollPositionRef.current !== null) {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        scrollContainer.scrollTop = savedScrollPositionRef.current;
      }
    }
  });

  // 组件挂载时和服务器列表变化时自动获取连接状态
  // 注意：不要在测试连接后立即刷新，避免重置滚动位置
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // 如果正在恢复滚动位置，完全跳过自动刷新
    if (isRestoringScrollRef.current) {
      return;
    }
    
    // 如果最近10秒内测试过连接，跳过自动刷新（避免重置滚动位置）
    const timeSinceLastTest = Date.now() - lastTestTimeRef.current;
    if (timeSinceLastTest < 10000) {
      return;
    }
    
    // 只在首次加载完成时获取一次连接状态
    if (!hasInitializedRef.current && customServers.length > 0 && !isLoading) {
      hasInitializedRef.current = true;
      // 立即获取连接状态
      const fetchStatus = async () => {
        try {
          await refetchConnectionStatus();
        } catch (error) {
          console.error('Failed to fetch MCP connection status:', error);
        }
      };
      fetchStatus();
      // 注意：不在这里调用 invalidateQueries，避免触发自动刷新导致滚动重置
      // 如果需要最新状态，可以手动点击刷新按钮
    }
  }, [customServers.length, isLoading, queryClient, refetchConnectionStatus]);

  // 监听 connectionStatus 变化，在恢复滚动期间持续恢复滚动位置
  // 使用 useLayoutEffect 确保在 DOM 更新前执行
  useLayoutEffect(() => {
    // 只在恢复滚动期间处理 connectionStatus 变化
    if (!isRestoringScrollRef.current || savedScrollPositionRef.current === null) {
      return;
    }
    
    // 如果最近测试过连接，持续恢复滚动位置
    const timeSinceLastTest = Date.now() - lastTestTimeRef.current;
    if (timeSinceLastTest > 8000) {
      // 8秒后停止恢复
      return;
    }
    
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    
    const savedPosition = savedScrollPositionRef.current;
    // 立即恢复，不等待渲染
    scrollContainer.scrollTop = savedPosition;
  }, [connectionStatus]);
  
  // 使用 useEffect 作为补充，在 DOM 更新后再次检查
  useEffect(() => {
    if (!isRestoringScrollRef.current || savedScrollPositionRef.current === null) {
      return;
    }
    
    const timeSinceLastTest = Date.now() - lastTestTimeRef.current;
    if (timeSinceLastTest > 8000) {
      return;
    }
    
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    
    const savedPosition = savedScrollPositionRef.current;
    const currentScroll = scrollContainer.scrollTop;
    
    // 如果滚动位置被重置，恢复它
    if (currentScroll < savedPosition - 10) {
      scrollContainer.scrollTop = savedPosition;
      
      // 使用 requestAnimationFrame 确保在 DOM 更新后再次检查
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = scrollContainerRef.current;
          if (container && isRestoringScrollRef.current && savedScrollPositionRef.current === savedPosition) {
            const finalScroll = container.scrollTop;
            if (finalScroll < savedPosition - 10) {
              container.scrollTop = savedPosition;
            }
          }
        });
      });
    }
  }, [connectionStatus]);

  // 获取MCP服务器配置
  useEffect(() => {
    const fetchServers = async () => {
      setIsLoading(true);
      try {
        const baseEl = document.querySelector('base');
        const baseHref = baseEl?.getAttribute('href') || '/';
        const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });

        // 检查响应内容类型
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          
          if (isJson) {
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
              // JSON 解析失败，使用默认错误信息
            }
          } else {
            // 如果不是 JSON，可能是 HTML 错误页面
            const text = await response.text().catch(() => '');
            if (text.includes('<!DOCTYPE') || text.includes('<html')) {
              errorMessage = `服务器返回了 HTML 页面而不是 JSON。可能是认证失败或路由错误。状态码: ${response.status}`;
            } else {
              errorMessage = text || errorMessage;
            }
          }
          
          throw new Error(errorMessage);
        }

        if (!isJson) {
          const text = await response.text();
          throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
        }

        const data = await response.json();
        setCustomServers(data.servers || []);
      } catch (error) {
        console.error('Error fetching MCP servers:', error);
        showToast({
          message: `获取MCP服务器配置失败: ${error instanceof Error ? error.message : '未知错误'}`,
          status: 'error',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchServers();
  }, [showToast, token]);

  // 刷新服务器列表
  const refreshServers = async () => {
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('获取MCP服务器配置失败');
      }

      const data = await response.json();
      setCustomServers(data.servers || []);
    } catch (error) {
      console.error('Error refreshing servers:', error);
    }
  };

  const handleCreateNew = () => {
    setEditingServer(undefined);
    setShowEditor(true);
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditingServer(server);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingServer(undefined);
  };

  const handleSave = async (server: MCPServerConfig) => {
    setIsSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ server }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      // 清除缓存并刷新配置
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      await refetch();
      await refreshServers();
      // 刷新连接状态，以便新增的服务能显示连接状态
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      await refetchConnectionStatus();
      setShowEditor(false);
      setEditingServer(undefined);
    } catch (error) {
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (serverName: string) => {
    if (!confirm(`确定要删除MCP服务器配置 "${serverName}" 吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {};
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/mcp/custom/${encodeURIComponent(serverName)}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '删除失败');
      }

      showToast({
        message: 'MCP服务器配置删除成功',
        status: 'success',
      });

      // 清除缓存并刷新配置
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      await refetch();
      await refreshServers();
      // 刷新连接状态，以便更新连接状态列表
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      await refetchConnectionStatus();
    } catch (error) {
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  // 提取错误消息的辅助函数，处理嵌套的 JSON 格式错误
  const extractErrorMessage = useCallback((message: string): string => {
    if (!message) return '未知错误';
    
    // 尝试从 JSON 字符串中提取错误消息
    // 格式可能是: Error POSTing to endpoint: {"error":{"message":"Request limit exceeded."}}
    // 或者直接是 JSON: {"error":{"message":"Request limit exceeded."}}
    try {
      // 先尝试直接解析整个消息是否为 JSON
      try {
        const directParsed = JSON.parse(message);
        if (directParsed.error?.message) {
          return directParsed.error.message;
        }
        if (directParsed.message) {
          return directParsed.message;
        }
      } catch (e) {
        // 不是纯 JSON，继续查找 JSON 部分
      }
      
      // 查找 JSON 部分（可能在消息的中间或末尾）
      const jsonMatch = message.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (parsed.error?.message) {
          return parsed.error.message;
        }
        if (parsed.message) {
          return parsed.message;
        }
      }
    } catch (e) {
      // 如果解析失败，继续使用原始消息
    }
    
    // 如果消息是通用的失败消息，尝试提取服务器名称后的内容
    // 例如: "Failed to reinitialize MCP server '图表生成'" -> 返回原始消息
    // 但这种情况应该由后端返回真正的错误消息，所以这里直接返回
    return message;
  }, []);

  const mcpServerDefinitions = useMemo(() => {
    return customServers.map((server) => ({
      serverName: server.serverName,
      config: {
        ...server.config,
        customUserVars: server.config.customUserVars ?? {},
      },
    }));
  }, [customServers]);

  const handleTestConnection = useCallback(
    async (serverName: string) => {
      // 记录测试时间，防止后续自动刷新重置滚动位置
      lastTestTimeRef.current = Date.now();
      
      // 保存当前滚动位置
      const scrollContainer = scrollContainerRef.current;
      const savedScrollTop = scrollContainer?.scrollTop ?? 0;

      // 清除之前的错误消息
      setServerErrorMessages((prev) => {
        const updated = { ...prev };
        delete updated[serverName];
        return updated;
      });

      setTestingServers((prev) => ({ ...prev, [serverName]: true }));
      try {
        const response = await reinitializeMutation.mutateAsync(serverName);
        
        if (response.success) {
          showToast({
            message: `MCP服务器 "${serverName}" 测试连接成功`,
            status: 'success',
          });
          
          // 清除错误消息
          setServerErrorMessages((prev) => {
            const updated = { ...prev };
            delete updated[serverName];
            return updated;
          });
          
          // 先恢复滚动位置
          restoreScrollPosition(savedScrollTop);
          
          // 刷新连接状态，以便显示最新的连接状态
          // 在恢复滚动位置后再刷新，避免滚动位置重置
          setTimeout(async () => {
            await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
            await refetchConnectionStatus();
          }, 100);
        } else {
          const errorMessage = extractErrorMessage(response.message || '未知错误');
          // 保存错误消息
          setServerErrorMessages((prev) => ({
            ...prev,
            [serverName]: errorMessage,
          }));
          
          showToast({
            message: `MCP服务器 "${serverName}" 测试连接失败: ${errorMessage}`,
            status: 'error',
          });
          
          // 失败时也恢复滚动位置
          restoreScrollPosition(savedScrollTop);
          
          // 刷新连接状态，以便显示错误状态
          setTimeout(async () => {
            await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
            await refetchConnectionStatus();
          }, 100);
        }
      } catch (error) {
        const rawErrorMessage = error instanceof Error ? error.message : '未知错误';
        const errorMessage = extractErrorMessage(rawErrorMessage);
        // 保存错误消息
        setServerErrorMessages((prev) => ({
          ...prev,
          [serverName]: errorMessage,
        }));
        
        showToast({
          message: `MCP服务器 "${serverName}" 测试连接失败: ${errorMessage}`,
          status: 'error',
        });
        
        // 失败时也恢复滚动位置
        restoreScrollPosition(savedScrollTop);
        
        // 刷新连接状态，以便显示错误状态
        setTimeout(async () => {
          await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
          await refetchConnectionStatus();
        }, 100);
      } finally {
        setTestingServers((prev) => ({ ...prev, [serverName]: false }));
      }
    },
    [reinitializeMutation, showToast, queryClient, restoreScrollPosition, extractErrorMessage],
  );

  const handleRefreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      showToast({
        message: '连接状态已刷新',
        status: 'success',
      });
    } catch (error) {
      console.error('[MCP Management] Failed to refresh status:', error);
      showToast({
        message: '刷新连接状态失败',
        status: 'error',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, showToast]);

  const getStatusIcon = (connectionState?: string) => {
    switch (connectionState) {
      case 'connected':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'disconnected':
        return <XCircle className="h-4 w-4 text-gray-400" />;
      case 'connecting':
        return <Clock className="h-4 w-4 text-yellow-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = (connectionState?: string, errorMessage?: string) => {
    // 如果有错误消息，根据错误类型显示不同的文本
    if (connectionState === 'error' && errorMessage) {
      const lowerErrorMessage = errorMessage.toLowerCase();
      // 检测 HTTP 429 或 Request limit exceeded
      if (
        lowerErrorMessage.includes('request limit exceeded') ||
        lowerErrorMessage.includes('429') ||
        lowerErrorMessage.includes('rate limit') ||
        lowerErrorMessage.includes('访问达上限') ||
        lowerErrorMessage.includes('访问上限')
      ) {
        return 'API访问达上限';
      }
      // 检测其他常见错误
      if (lowerErrorMessage.includes('not found') || lowerErrorMessage.includes('404')) {
        return '服务器未找到';
      }
      if (lowerErrorMessage.includes('timeout') || lowerErrorMessage.includes('超时')) {
        return '连接超时';
      }
      if (lowerErrorMessage.includes('unauthorized') || lowerErrorMessage.includes('401')) {
        return '认证失败';
      }
      if (lowerErrorMessage.includes('forbidden') || lowerErrorMessage.includes('403')) {
        return '访问被拒绝';
      }
      // 默认显示错误消息的前50个字符
      return errorMessage.length > 50 ? `${errorMessage.substring(0, 50)}...` : errorMessage;
    }
    
    switch (connectionState) {
      case 'connected':
        return '连接正常';
      case 'disconnected':
        return '未连接';
      case 'connecting':
        return '连接中';
      case 'error':
        return '连接失败';
      default:
        return '未连接'; // 默认显示未连接，而不是未知
    }
  };

  const getStatusColor = (connectionState?: string) => {
    switch (connectionState) {
      case 'connected':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'disconnected':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
      case 'connecting':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
      case 'error':
        return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  // 如果显示编辑器，渲染编辑器（必须在所有 hooks 之后）
  if (showEditor) {
    return (
      <MCPConfigEditor
        server={editingServer}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">MCP服务器管理</h2>
          <p className="mt-1 text-sm text-text-primary">
            管理MCP服务器配置，可以增删改服务器配置并测试连接
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换按钮 */}
          <div className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setViewMode('detailed')}
              className={cn(
                'rounded px-2 py-1 text-sm transition-colors',
                viewMode === 'detailed'
                  ? 'bg-surface-primary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
              title="详细视图"
              aria-label="详细视图"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={cn(
                'rounded px-2 py-1 text-sm transition-colors',
                viewMode === 'compact'
                  ? 'bg-surface-primary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
              title="表格视图"
              aria-label="表格视图"
            >
              <Grid className="h-4 w-4" />
            </button>
        </div>
        <Button
          type="button"
            onClick={handleCreateNew}
            className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
        >
            <Plus className="h-4 w-4" />
            添加MCP服务器
        </Button>
        </div>
      </div>

      <div 
        ref={scrollContainerRef} 
        className="flex-1 overflow-auto"
        onScroll={(e) => {
          // 如果正在恢复滚动，阻止滚动重置
          if (isRestoringScrollRef.current && savedScrollPositionRef.current !== null) {
            const container = e.currentTarget;
            const savedPosition = savedScrollPositionRef.current;
            const currentScroll = container.scrollTop;
            // 如果滚动位置被重置到接近顶部，恢复它
            if (currentScroll < savedPosition - 10) {
              container.scrollTop = savedPosition;
            }
          }
        }}
      >
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <p className="text-sm">加载中...</p>
          </div>
        ) : mcpServerDefinitions.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
            <p className="text-sm">暂无MCP服务器配置</p>
            <p className="text-xs text-text-tertiary">
              点击右上角"添加MCP服务器"按钮开始创建
            </p>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === 'compact'
                ? 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3'
                : 'space-y-2',
            )}
          >
          {mcpServerDefinitions.map((server) => {
            const serverStatus = connectionStatus?.[server.serverName];
            const errorMessage = serverErrorMessages[server.serverName];
              // 如果有错误消息，显示为 error 状态
              const connectionState = errorMessage 
                ? 'error' 
                : serverStatus?.connectionState ?? 'disconnected';
            const isTesting = testingServers[server.serverName] || false;
            const requiresOAuth = serverStatus?.requiresOAuth || false;

              if (viewMode === 'compact') {
                // 表格视图：只显示服务器名称和连接状态
            return (
              <div
                key={server.serverName}
                    className="relative rounded-lg border border-border-light bg-surface-primary p-3 pr-10"
              >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(connectionState)}
                      <div className="min-w-0 flex-1">
                        <h4 className="line-clamp-1 text-sm font-semibold text-text-primary">
                          {server.serverName}
                        </h4>
                        <p className="mt-1 text-xs text-text-secondary">
                          {getStatusText(connectionState, errorMessage)}
                        </p>
                      </div>
                    </div>
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleTestConnection(server.serverName);
                        }}
                        disabled={isTesting || reinitializeMutation.isLoading}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                        title="测试连接"
                        aria-label="测试连接"
                      >
                        <RefreshCw
                          className={cn(
                            'h-4 w-4',
                            (isTesting || reinitializeMutation.isLoading) && 'animate-spin',
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(server)}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover"
                        title="编辑MCP服务器配置"
                        aria-label="编辑"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(server.serverName)}
                        className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="删除MCP服务器配置"
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              }

              // 详细视图：显示完整信息
              return (
                <div
                  key={server.serverName}
                  className="relative rounded-lg border border-border-light bg-surface-primary p-4"
                >
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(server)}
                      className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                      title="编辑MCP服务器配置"
                      aria-label="编辑"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(server.serverName)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="删除MCP服务器配置"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mb-3 flex items-center justify-between pr-20">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(connectionState)}
                      <h3 className="text-base font-semibold text-text-primary">
                        {server.serverName}
                      </h3>
                    </div>
                    <span
                      className={cn(
                        'rounded-xl px-2 py-0.5 text-xs font-medium',
                        getStatusColor(connectionState),
                      )}
                    >
                      {getStatusText(connectionState, errorMessage)}
                    </span>
                    {requiresOAuth && (
                      <span className="rounded-xl bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        OAuth
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleTestConnection(server.serverName);
                    }}
                    disabled={isTesting || reinitializeMutation.isLoading}
                    className="btn btn-neutral border-token-border-light relative flex items-center gap-2 rounded-lg px-3 py-2"
                    aria-label={`测试连接 ${server.serverName}`}
                  >
                    <RefreshCw
                        className={cn(
                          'h-4 w-4',
                          (isTesting || reinitializeMutation.isLoading) && 'animate-spin',
                        )}
                    />
                    {isTesting || reinitializeMutation.isLoading ? '测试中...' : '测试连接'}
                  </Button>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <span className="font-medium">连接状态:</span>
                    <span>{getStatusText(connectionState, errorMessage)}</span>
                  </div>
                  {server.config.customUserVars &&
                    Object.keys(server.config.customUserVars).length > 0 && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <span className="font-medium">自定义变量:</span>
                        <span>{Object.keys(server.config.customUserVars).length} 个</span>
                      </div>
                    )}
                    {server.config.type && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <span className="font-medium">类型:</span>
                        <span>{server.config.type}</span>
                      </div>
                    )}
                    {server.config.url && (
                    <div className="flex items-center gap-2 text-text-secondary">
                        <span className="font-medium">URL:</span>
                        <span className="truncate text-xs">{server.config.url}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}

