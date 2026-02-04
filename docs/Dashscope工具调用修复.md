# Dashscope 工具调用问题修复文档

## 问题描述

在使用 Dashscope（通过 OpenAI 兼容 API 调用 Deepseek 等模型）时，工具调用会在执行过程中异常终止，导致对话无法正常继续。而直接使用 Deepseek API 则可以正常完成工具调用。

## 问题根源分析

Dashscope 的流式响应格式与标准 OpenAI 格式存在差异：

1. **工具调用信息分散在多个 chunk 中**
   - 第一个 chunk 包含 `name` 和 `id`
   - 后续 chunk 只包含 `arguments` 片段
   - LangChain 在合并时未能正确保留首个 chunk 的 `name` 和 `id`

2. **工具调用存储位置不同**
   - Dashscope 将工具调用放在 `message.additional_kwargs.tool_calls` 中
   - 标准格式应在 `message.tool_calls` 中
   - 导致 ToolNode 无法正确读取工具调用

3. **流式累积时信息丢失**
   - 最终消息中的 `function.name` 和 `id` 变成空字符串
   - ToolNode 无法确定要执行哪个工具

## 修复方案

### 核心思路

在流式处理时保存工具调用的 `name` 和 `id`，在后续处理中恢复这些丢失的信息。

### 修复文件清单

#### 1. `agents-Aipyq/src/graphs/Graph.ts`

添加新的 Map 来存储工具调用信息：

```typescript
// 新增属性
toolCallInfoByIndex: Map<number, { name: string; id: string }> = new Map();

// 在 reset() 方法中重置
this.toolCallInfoByIndex = resetIfNotEmpty(this.toolCallInfoByIndex, new Map());

// 创建 ToolNode 时传递
toolCallInfoByIndex: this.toolCallInfoByIndex,
```

#### 2. `agents-Aipyq/src/tools/handlers.ts`

在 `handleToolCallChunks` 中保存工具调用的 `name` 和 `id`：

```typescript
for (const chunk of toolCallChunks) {
  const index = chunk.index ?? 0;
  const existingInfo = graph.toolCallInfoByIndex.get(index);
  const newName = chunk.name && chunk.name !== '' ? chunk.name : existingInfo?.name ?? '';
  const newId = chunk.id && chunk.id !== '' ? chunk.id : existingInfo?.id ?? '';
  if (newName || newId) {
    graph.toolCallInfoByIndex.set(index, { name: newName, id: newId });
  }
}
```

#### 3. `agents-Aipyq/src/tools/ToolNode.ts`

增强 `toolsCondition` 检测 `additional_kwargs.tool_calls`：

```typescript
// 检测未解析的工具调用
let hasUnparsedToolCalls = false;
if (additionalToolCalls > 0 && standardToolCalls === 0) {
  hasUnparsedToolCalls = additionalKwargsToolCalls?.some(tc => {
    const funcName = tc?.function?.name;
    const funcArgs = tc?.function?.arguments;
    return (funcName && funcName.length > 0) || (funcArgs && funcArgs.length > 0);
  }) ?? false;
}
const hasToolCalls = ('tool_calls' in message && (message.tool_calls?.length ?? 0) > 0) || hasUnparsedToolCalls;
```

在 `run()` 方法中转换 `additional_kwargs.tool_calls` 并恢复信息：

```typescript
if (toolCallsToProcess.length === 0 && additionalKwargsToolCalls?.length) {
  toolCallsToProcess = additionalKwargsToolCalls.map((tc, index) => {
    const savedInfo = this.toolCallInfoByIndex?.get(index);
    let name = tc.function?.name || savedInfo?.name || '';
    let id = tc.id || savedInfo?.id || `generated_${Date.now()}`;
    // 转换为标准格式
  }).filter(tc => tc.name && tc.name.length > 0);
}
```

#### 4. `agents-Aipyq/src/types/tools.ts`

添加类型定义：

```typescript
export type ToolNodeOptions = {
  // ... 其他属性
  toolCallInfoByIndex?: Map<number, { name: string; id: string }>;
};
```

#### 5. `agents-Aipyq/src/events.ts`

在 `ModelEndHandler` 中检查并转换 `additional_kwargs.tool_calls`：

```typescript
const additionalKwargsToolCalls = data?.output?.additional_kwargs?.tool_calls;

if ((!toolCalls || toolCalls.length === 0) && additionalKwargsToolCalls?.length) {
  toolCalls = additionalKwargsToolCalls.map((tc, index) => {
    const savedInfo = graph.toolCallInfoByIndex.get(index);
    const name = tc.function?.name || savedInfo?.name || '';
    const id = tc.id || savedInfo?.id || `generated_${Date.now()}`;
    return { id, name, args, type: 'tool_call' };
  });
}
```

#### 6. `agents-Aipyq/src/stream.ts`

改进 `updateContent` 允许处理只有 args 的 chunk：

```typescript
const hasExistingToolCall = existingContent?.tool_call != null;
const hasArgsToAppend = toolCallArgs != null && toolCallArgs !== '';
if (!hasValidName && !finalUpdate && !hasExistingToolCall && !hasArgsToAppend) {
  return;
}
```

在 `aggregateContent` 中保留 existing name/id：

```typescript
name: toolCallDelta.name ?? existingContent?.tool_call?.name,
id: toolCallId ?? toolCallDelta.id ?? existingContent?.tool_call?.id,
```

## 修复原理流程图

```
Dashscope 流式响应:
┌─────────────────────────────────────────────────────────────┐
│ Chunk 1: { id: "call_xxx", name: "writing", args: "" }      │
│ Chunk 2: { id: "",         name: "",        args: "{" }     │
│ Chunk 3: { id: "",         name: "",        args: "..." }   │
│ Chunk N: { id: "",         name: "",        args: "}" }     │
└─────────────────────────────────────────────────────────────┘
                              ↓
              handleToolCallChunks 保存 name/id
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ toolCallInfoByIndex.set(0, { name: "writing", id: "call_xxx" })
└─────────────────────────────────────────────────────────────┘
                              ↓
              ToolNode/ModelEndHandler 恢复信息
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ 完整工具调用: { id: "call_xxx", name: "writing", args: {...} }
└─────────────────────────────────────────────────────────────┘
```

## 关键修复点总结

| 修复点 | 说明 |
|--------|------|
| 保存 | 在流式处理时，保存第一个 chunk 中的 `name` 和 `id` |
| 检测 | 在 `toolsCondition` 中检测 `additional_kwargs.tool_calls` |
| 恢复 | 在 ToolNode 和 ModelEndHandler 中，使用保存的信息恢复缺失的 `name` 和 `id` |
| 累积 | 改进 `updateContent` 和 `aggregateContent` 正确累积工具调用参数 |

## 测试验证

修复后，Dashscope 的工具调用可以正常完成，包括：
- `set_memory` 内置记忆工具
- `writing` 写作工具
- 多轮工具调用

## 适用范围

此修复方案适用于所有使用 OpenAI 兼容 API 的提供商，包括但不限于：
- Dashscope (阿里云)
- 其他 OpenAI 兼容的第三方服务

---

*修复日期：2026-02-03*
