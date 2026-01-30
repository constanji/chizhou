import React from 'react';
import { EModelEndpoint } from '@aipyq/data-provider';
import { Wrench } from 'lucide-react';
import { useAvailableToolsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function AvailableToolsManagement() {
  const localize = useLocalize();
  const { data: tools, isLoading } = useAvailableToolsQuery(EModelEndpoint.agents);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">工具管理</h2>
        <p className="mt-1 text-sm text-text-secondary">
          仅展示当前已注册的工具，具体请在智能体配置中启用。
        </p>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-light bg-surface-primary p-3">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-text-secondary">
            {localize('com_ui_loading') ?? '加载中...'}
          </div>
        ) : !tools || tools.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-text-secondary">
            暂无可用工具
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tools.map((tool) => (
              <li
                key={tool.pluginKey}
                className="flex flex-col justify-between rounded-md border border-border-light bg-surface-secondary px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {tool.icon ? (
                    <img
                      src={tool.icon}
                      alt={tool.name}
                      className="h-6 w-6 shrink-0 rounded bg-white"
                    />
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-primary text-text-secondary">
                      <Wrench className="h-4 w-4" />
                    </div>
                  )}
                  <span className="line-clamp-1 text-sm font-medium text-text-primary">
                    {tool.name}
                  </span>
                </div>
                {tool.description && (
                  <p className="mt-2 line-clamp-3 text-xs text-text-secondary">
                    {tool.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


