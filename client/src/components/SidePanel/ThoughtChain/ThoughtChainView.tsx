import { useToolCallsWithThoughtChains } from '~/hooks/useToolCallsWithThoughtChains';
import ThoughtChainPanel from '../ThoughtChainPanel';

/**
 * 思考链视图组件 - 独立显示在右侧边栏位置
 */
export default function ThoughtChainView() {
  const { toolCallsByMessage } = useToolCallsWithThoughtChains();

  return (
    <ThoughtChainPanel
      toolCallsByMessage={toolCallsByMessage}
      shouldRender={true}
      onRenderChange={() => {}}
    />
  );
}

