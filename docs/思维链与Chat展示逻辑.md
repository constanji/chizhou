## 思维链与 Chat 内容展示逻辑说明

### 1. 目标概述

当前系统将 **“思维链（工具调用过程）”** 与 **“面向用户的最终回答”** 分离展示：

- **右侧思维链侧边栏**：专门展示工具调用过程、SQL 推理、执行结果等“过程级信息”。
- **中间 Chat 主区域**：只展示对用户有意义的自然语言内容（工具前说明 + 工具完成后的总结），不展示内部思维链和工具卡片。

---

### 2. 相关文件结构

主要逻辑分布在以下文件中：

- `client/src/hooks/useToolCallsWithThoughtChains.ts`
  - 周期性从当前消息列表中提取工具调用，生成 `toolCallsByMessage`，供思维链侧边栏使用。

- `client/src/utils/parseDatServerResponse.ts`
  - `parseDatServerResponse`：解析 dat-server 返回的 SQL 思维链结构。
  - `extractToolCallsByMessage`：
    - 从全部消息中按轮次提取：
      - `toolCalls`: 工具调用列表（含 because/sql_executor/social/generate_column_chart 等）。
      - `thoughtChain`: 仅对 dat-server 工具解析。
      - `contentItems`: 每轮中与工具相关的文本与调用分片。

- `client/src/components/SidePanel/ThoughtChain/ThoughtChainView.tsx`
  - 使用 `useToolCallsWithThoughtChains` 获取 `toolCallsByMessage`，渲染思维链侧边栏。

- `client/src/components/SidePanel/ThoughtChainPanel.tsx`
  - 将 `toolCallsByMessage` 转换为 `ThoughtChain` 组件可用的 `items`：
    - 仅保留“包含工具调用”的轮次。
    - 文本颜色、字号等 UI 细节控制。

- `client/src/components/SidePanel/SidePanelGroup.tsx`
  - 管理整体布局与右侧思维链面板：
    - 使用 `ResizablePanelGroup` 控制主区域 +（可选）Artifacts + 思维链。
    - 思维链面板的展开 / 收起逻辑。
    - 右侧思维链左侧的 `NavToggle` 开关按钮。

- `client/src/components/Chat/Messages/Content/ContentParts.tsx`
  - 决定 **Chat 主区域** 每条消息中各个 `content part` 的展示与过滤：
    - 是否包含工具调用 / 思维链（`TOOL_CALL` / `THINK`）。
    - 哪些 TEXT 应该展示给用户，哪些只在思维链中出现。

---

### 3. 右侧思维链侧边栏展示逻辑

#### 3.1 按消息 / 轮次分组

在 `extractToolCallsByMessage` 中：

- 遍历所有消息，只处理 `assistant` 消息（`isCreatedByUser === false`）。
- 对每条消息：
  - 收集 `toolCalls`（所有工具调用及其 `args/output` 等）。
  - 收集 `contentItems`：
    - `type: 'text'`：来自 `ContentTypes.TEXT` 的非空文本。
    - `type: 'toolCall'`：`ContentTypes.TOOL_CALL` + 可选 `thoughtChain`。
  - 标记该轮是否有进行中的工具调用：`isStreaming`。

> 重要：  
> 在构建 `contentItems` 时，**会过滤掉“最后一个 TOOL_CALL 之后的所有文本”**，因为这部分通常是“最终总结回答”，只应出现在 Chat 主区域。

#### 3.2 只展示包含工具调用的轮次

在 `ThoughtChainPanel.tsx` 中：

- 使用：

  ```ts
  const chainItems = toolCallsByMessage
    .filter((messageData) => messageData.toolCalls && messageData.toolCalls.length > 0)
    .map(/* ... */);
  ```

- 即：**只要该轮没有工具调用，整个轮次不会出现在思维链中**。

#### 3.3 UI 与样式

- 每轮的 `title`：`第 {messageIndex} 轮对话`。
- `description`：如 `2 个工具调用，3 段文本`。
- 文本内容：
  - 标题：`text-primary`，`text-sm`。
  - 普通说明文本：`text-tertiary`，`text-sm`，对比度更低。
- 工具状态图标：
  - `loading`：`LoadingOutlined`。
  - `success`：`CheckCircleTwoTone`（绿色）。
  - `error/cancelled`：`CloseCircleTwoTone`（红色）。

---

### 4. Chat 主区域展示逻辑

#### 4.1 用户消息

- `isCreatedByUser === true`：
  - 不参与思维链逻辑，文本原样展示（支持 Markdown 或纯文本）。

#### 4.2 助手消息：无工具调用 / 思维链

- 若该条消息的 `content` **不包含任何**：
  - `ContentTypes.TOOL_CALL`
  - `ContentTypes.THINK`
  - reasoning delta（`think` 字段）
- 则视为“普通回答”，**不做过滤**，所有分片按原逻辑渲染到 Chat。

#### 4.3 助手消息：包含工具调用 / 思维链

在 `ContentParts.tsx` 内部，通过 `filteredContent` 做统一过滤：

1. 判断是否包含“工具 / 思维链”：

   ```ts
   const hasToolOrThink = content.some(
     (part) =>
       part &&
       (part.type === ContentTypes.TOOL_CALL ||
         part.type === ContentTypes.THINK ||
         (part as Agents.ReasoningDeltaUpdate)?.think),
   );
   ```

2. 若 `hasToolOrThink === true`，按以下规则过滤：

   - 预计算三个索引：

     ```ts
     let firstToolOrThinkIndex = -1;
     let lastToolOrThinkIndex = -1;
     let lastTextIndex = -1;
     ```

     - `firstToolOrThinkIndex`：第一个 `TOOL_CALL/THINK` 的位置。
     - `lastToolOrThinkIndex`：最后一个 `TOOL_CALL/THINK` 的位置。
     - `lastTextIndex`：最后一个 `TEXT` 的位置（视为“最终总结回答”）。

   - 实际过滤规则：

     ```ts
     const filteredContent = content.filter((part, idx) => {
       if (!part) return false;

       // 1）不在 chat 中展示 THINK（思维链）内容
       if (part.type === ContentTypes.THINK) {
         return false;
       }

       // 2）TEXT：只保留
       //   a) 第一个 TOOL_CALL/THINK 之前的所有 TEXT（调用工具前的正常回答）
       //   b) 最后一段 TEXT（调用工具后对用户的最终总结）
       if (part.type === ContentTypes.TEXT) {
         if (firstToolOrThinkIndex === -1) {
           // 没有工具 / THINK，则保留所有 TEXT
           return true;
         }
         const isBeforeFirstTool = idx < firstToolOrThinkIndex;
         const isFinalSummary = idx === lastTextIndex;
         return isBeforeFirstTool || isFinalSummary;
       }

       // 3）所有 TOOL_CALL（工具调用卡片）都从 chat 中移除，只出现在右侧思维链
       if (part.type === ContentTypes.TOOL_CALL) {
         return false;
       }

       // 4）其他类型（图片等）保持不变
       return true;
     });
     ```

> 效果总结：
>
> - Chat 中：
>   - 保留工具调用前的正常话术（如“我来帮您查询 VIP 客户数量并按地区划分。”）。
>   - 保留工具完成后的最终总结回答（如“根据查询结果，VIP 客户按地区分布为…”）。
>   - 隐藏思维链细节（THINK）和所有工具调用卡片（TOOL_CALL），以及中间的过程性叙事。
>
> - 思维链侧边栏：
>   - 保留每个工具调用及其思维链 / SQL / 过程说明，方便调试和溯源。

---

### 5. 行为对比一览

| 内容类型                         | 是否在 Chat 主区域展示 | 是否在思维链侧边栏展示 |
| -------------------------------- | ----------------------- | ------------------------ |
| 用户消息（User）                 | ✅ 全部展示             | ❌ 不展示               |
| 纯文本助手消息（无工具 / THINK） | ✅ 全部展示             | ❌ 不展示               |
| 工具前助手文本                   | ✅ 展示                 | ✅（若在最后一次工具前）|
| 工具过程叙事文本                 | ❌ 隐藏                 | ✅ 展示                 |
| 工具后最终总结文本               | ✅ 展示                 | ❌（已视为最终回答）    |
| 工具调用卡片（TOOL_CALL）        | ❌ 隐藏                 | ✅ 展示                 |
| 思维链 / THINK 内容              | ❌ 隐藏                 | ✅ 展示                 |

---

### 6. 设计初衷与后续扩展建议

- **设计初衷**：
  - Chat 主区域只承载“用户对话体验”：尽量简洁，只看得到结论和必要上下文。
  - 思维链侧边栏承载“调试 / 透明度需求”：完整保留工具和推理细节。

- **后续可扩展点**：
  - 增加开关配置：允许高级用户在 Chat 中看到部分工具卡片或简化版过程说明。
  - 针对特定工具（如 `social`、`because`）配置白名单 / 黑名单，精细控制是否在 Chat 中展示。
  - 在思维链内增加“复制 SQL / 导出过程”等快捷操作，增强调试效率。


