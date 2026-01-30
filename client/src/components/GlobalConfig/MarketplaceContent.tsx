import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMediaQuery } from '@aipyq/client';
import { PermissionTypes, Permissions, QueryKeys, SystemRoles, PermissionBits } from '@aipyq/data-provider';
import type t from '@aipyq/data-provider';
import { useHasAccess, useLocalize, TranslationKeys, useAuthContext } from '~/hooks';
import { useGetEndpointsQuery, useGetAgentCategoriesQuery } from '~/data-provider';
import { useMarketplaceAgentsInfiniteQuery } from '~/data-provider/Agents';
import { useChatContext } from '~/Providers';
import { cn, clearMessagesCache, renderAgentAvatar } from '~/utils';
import { List, Grid } from 'lucide-react';
import CategoryTabs from '~/components/Agents/CategoryTabs';
import AgentDetail from '~/components/Agents/AgentDetail';
import SearchBar from '~/components/Agents/SearchBar';
import AgentGrid from '~/components/Agents/AgentGrid';

/**
 * MarketplaceContent - Simplified marketplace component for use in tabs
 * 
 * This is a simplified version of the full AgentMarketplace component,
 * designed to be embedded within the GlobalConfigManager tabs.
 */
export default function MarketplaceContent() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversation, newConversation } = useChatContext();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  // Get URL parameters
  const searchQuery = searchParams.get('q') || '';
  const selectedAgentId = searchParams.get('agent_id') || '';

  // Animation state
  type Direction = 'left' | 'right';
  const [displayCategory, setDisplayCategory] = useState<string>('all');
  const [nextCategory, setNextCategory] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [animationDirection, setAnimationDirection] = useState<Direction>('right');

  // Ref for the scrollable container to enable infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Local state
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<t.Agent | null>(null);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');

  // Ensure endpoints config is loaded first (required for agent queries)
  useGetEndpointsQuery();

  // Fetch categories using existing query pattern
  const categoriesQuery = useGetAgentCategoriesQuery({
    staleTime: 1000 * 60 * 15, // 15 minutes - categories rarely change
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  // Handle initial category
  useEffect(() => {
    if (categoriesQuery.data && categoriesQuery.data.length > 0) {
      const hasPromoted = categoriesQuery.data.some((cat) => cat.value === 'promoted');
      if (hasPromoted && displayCategory === 'all') {
        setDisplayCategory('promoted');
      }
    }
  }, [categoriesQuery.data, displayCategory]);

  /**
   * Handle agent card selection
   */
  const handleAgentSelect = (agent: t.Agent) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('agent_id', agent.id);
    setSearchParams(newParams);
    setSelectedAgent(agent);
    setIsDetailOpen(true);
  };

  /**
   * Handle closing the agent detail dialog
   */
  const handleDetailClose = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('agent_id');
    setSearchParams(newParams);
    setSelectedAgent(null);
    setIsDetailOpen(false);
  };

  /**
   * Determine ordered tabs to compute indices for direction
   */
  const orderedTabs = useMemo<string[]>(() => {
    const dynamic = (categoriesQuery.data || []).map((c) => c.value);
    const set = new Set<string>(dynamic);
    return Array.from(set);
  }, [categoriesQuery.data]);

  const getTabIndex = useCallback(
    (tab: string): number => {
      const idx = orderedTabs.indexOf(tab);
      return idx >= 0 ? idx : 0;
    },
    [orderedTabs],
  );

  /**
   * Handle category tab selection changes with directional animation
   */
  const handleTabChange = (tabValue: string) => {
    if (tabValue === displayCategory || isTransitioning) {
      return;
    }

    const currentIndex = getTabIndex(displayCategory);
    const newIndex = getTabIndex(tabValue);
    const direction: Direction = newIndex > currentIndex ? 'right' : 'left';

    setAnimationDirection(direction);
    setNextCategory(tabValue);
    setIsTransitioning(true);

    // Update search params to preserve search query
    const newParams = new URLSearchParams(searchParams);
    setSearchParams(newParams);

    // Complete transition after 300ms
    window.setTimeout(() => {
      setDisplayCategory(tabValue);
      setNextCategory(null);
      setIsTransitioning(false);
    }, 300);
  };

  /**
   * Handle search query changes
   */
  const handleSearch = (query: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (query.trim()) {
      newParams.set('q', query.trim());
    } else {
      newParams.delete('q');
    }

    setSearchParams(newParams);
  };

  // Check if a detail view should be open based on URL
  useEffect(() => {
    setIsDetailOpen(!!selectedAgentId);
  }, [selectedAgentId]);

  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  
  // 检查权限
  const hasMarketplacePermission = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });
  
  // 在Agent平台（管理员页面）中，管理员总是有权限访问智能体市场
  const hasAccessToMarketplace = isAdmin || hasMarketplacePermission;

  if (!hasAccessToMarketplace) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-secondary">您没有访问智能体市场的权限</p>
      </div>
    );
  }

  const tableQueryParams = useMemo(() => {
    const params: {
      requiredPermission: number;
      category?: string;
      search?: string;
      limit: number;
      promoted?: 0 | 1;
    } = {
      requiredPermission: PermissionBits.VIEW,
      limit: 15,
    };

    if (searchQuery) {
      params.search = searchQuery;
      if (displayCategory !== 'all' && displayCategory !== 'promoted') {
        params.category = displayCategory;
      }
    } else {
      if (displayCategory === 'promoted') {
        params.promoted = 1;
      } else if (displayCategory !== 'all') {
        params.category = displayCategory;
      }
    }
    return params;
  }, [displayCategory, searchQuery]);

  const {
    data: tableData,
    isLoading: tableLoading,
    isFetchingNextPage: tableFetchingNext,
    hasNextPage: tableHasNext,
    fetchNextPage: tableFetchNext,
  } = useMarketplaceAgentsInfiniteQuery(tableQueryParams, { enabled: viewMode === 'compact' });

  const tableAgents = useMemo(() => {
    if (!tableData?.pages) return [];
    return tableData.pages.flatMap((p) => p.data || []);
  }, [tableData?.pages]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky wrapper for search bar and categories */}
      <div className={cn('sticky z-10 bg-surface-secondary pb-4 pt-2', 'top-0')}>
        <div className="flex w-full items-center justify-between px-4 gap-2">
          {/* Search bar */}
          <div className="mx-auto flex max-w-2xl flex-1 gap-2 pb-4">
            <SearchBar value={searchQuery} onSearch={handleSearch} />
          </div>

          {/* 视图切换 */}
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
        </div>

        {/* Category tabs */}
        <CategoryTabs
          categories={categoriesQuery.data || []}
          activeTab={displayCategory}
          isLoading={categoriesQuery.isLoading}
          onChange={handleTabChange}
        />
      </div>

      {/* Scrollable content area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mx-auto max-w-4xl">
          {viewMode === 'detailed' && (
            <div className="relative overflow-hidden">
              {/* Current content pane */}
              <div
                className={cn(
                  isTransitioning &&
                    (animationDirection === 'right'
                      ? 'motion-safe:animate-slide-out-left'
                      : 'motion-safe:animate-slide-out-right'),
                )}
                key={`pane-current-${displayCategory}`}
              >
                {!searchQuery && (
                  <div className="mb-6 mt-6">
                    {(() => {
                      const getCategoryData = () => {
                        if (displayCategory === 'promoted') {
                          return {
                            name: localize('com_agents_top_picks'),
                            description: localize('com_agents_recommended'),
                          };
                        }
                        if (displayCategory === 'all') {
                          return {
                            name: localize('com_agents_all'),
                            description: localize('com_agents_all_description'),
                          };
                        }

                        const categoryData = categoriesQuery.data?.find(
                          (cat) => cat.value === displayCategory,
                        );
                        if (categoryData) {
                          return {
                            name: categoryData.label?.startsWith('com_')
                              ? localize(categoryData.label as TranslationKeys)
                              : categoryData.label,
                            description: categoryData.description?.startsWith('com_')
                              ? localize(categoryData.description as TranslationKeys)
                              : categoryData.description || '',
                          };
                        }

                        return {
                          name: displayCategory.charAt(0).toUpperCase() + displayCategory.slice(1),
                          description: '',
                        };
                      };

                      const { name, description } = getCategoryData();

                      return (
                        <div className="text-left">
                          <h2 className="text-2xl font-bold text-text-primary">{name}</h2>
                          {description && (
                            <p className="mt-2 text-text-secondary">{description}</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <AgentGrid
                  key={`grid-${displayCategory}`}
                  category={displayCategory}
                  searchQuery={searchQuery}
                  onSelectAgent={handleAgentSelect}
                  scrollElementRef={scrollContainerRef}
                />
              </div>

              {isTransitioning && nextCategory && (
                <div
                  className={cn(
                    'absolute inset-0',
                    animationDirection === 'right'
                      ? 'motion-safe:animate-slide-in-right'
                      : 'motion-safe:animate-slide-in-left',
                  )}
                  key={`pane-next-${nextCategory}-${animationDirection}`}
                >
                  {!searchQuery && (
                    <div className="mb-6 mt-6">
                      {(() => {
                        const getCategoryData = () => {
                          if (nextCategory === 'promoted') {
                            return {
                              name: localize('com_agents_top_picks'),
                              description: localize('com_agents_recommended'),
                            };
                          }
                          if (nextCategory === 'all') {
                            return {
                              name: localize('com_agents_all'),
                              description: localize('com_agents_all_description'),
                            };
                          }

                          const categoryData = categoriesQuery.data?.find(
                            (cat) => cat.value === nextCategory,
                          );
                          if (categoryData) {
                            return {
                              name: categoryData.label?.startsWith('com_')
                                ? localize(categoryData.label as TranslationKeys)
                                : categoryData.label,
                              description: categoryData.description?.startsWith('com_')
                                ? localize(
                                    categoryData.description as Parameters<typeof localize>[0],
                                  )
                                : categoryData.description || '',
                            };
                          }

                          return {
                            name:
                              (nextCategory || '').charAt(0).toUpperCase() +
                              (nextCategory || '').slice(1),
                            description: '',
                          };
                        };

                        const { name, description } = getCategoryData();

                        return (
                          <div className="text-left">
                            <h2 className="text-2xl font-bold text-text-primary">{name}</h2>
                            {description && (
                              <p className="mt-2 text-text-secondary">{description}</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <AgentGrid
                    key={`grid-${nextCategory}`}
                    category={nextCategory}
                    searchQuery={searchQuery}
                    onSelectAgent={handleAgentSelect}
                    scrollElementRef={scrollContainerRef}
                  />
                </div>
              )}
            </div>
          )}

          {viewMode === 'compact' && (
            <div className="mt-4">
              {tableLoading && tableAgents.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-text-secondary">
                  <p className="text-sm">加载中...</p>
                </div>
              ) : tableAgents.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-text-secondary">
                  <p className="text-sm">暂无数据</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {tableAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="relative rounded-lg border border-border-light bg-surface-primary p-3 cursor-pointer hover:bg-surface-hover transition-colors"
                      onClick={() => handleAgentSelect(agent)}
                    >
                      <div className="flex items-start gap-3">
                        {/* 头像 */}
                        <div className="flex-shrink-0">
                          {renderAgentAvatar(agent, { size: 'sm' })}
                        </div>
                        {/* 内容 */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-text-primary line-clamp-1 mb-1">
                            {agent.name}
                          </h4>
                          {agent.description && (
                            <p className="text-xs text-text-secondary line-clamp-2 mb-2">
                              {agent.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-text-tertiary">
                            {agent.category && (
                              <span className="rounded px-1.5 py-0.5 bg-surface-secondary">
                                {agent.category}
                              </span>
                            )}
                            {agent.model && (
                              <span className="truncate">{agent.model}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tableHasNext && (
                <div className="mt-4 flex items-center justify-center">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-4 py-2 text-sm transition-colors',
                      tableFetchingNext
                        ? 'bg-surface-secondary text-text-tertiary cursor-not-allowed'
                        : 'bg-primary text-white hover:bg-primary/90',
                    )}
                    onClick={() => tableFetchNext()}
                    disabled={tableFetchingNext}
                  >
                    {tableFetchingNext ? '加载中...' : '加载更多'}
                  </button>
                </div>
              )}
              {!tableHasNext && tableAgents.length > 0 && (
                <div className="mt-4 text-center text-sm text-text-secondary">
                  已无更多结果
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Agent detail dialog */}
      {isDetailOpen && selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
          isOpen={isDetailOpen}
          onClose={handleDetailClose}
        />
      )}
    </div>
  );
}
