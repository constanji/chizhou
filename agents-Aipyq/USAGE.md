# @aipyq/agents 使用指南

这是一个基于 LangChain 的 AI 代理框架，支持多种 LLM 提供商（OpenAI、Anthropic、Google、Bedrock 等）。

## 安装和使用

### 方式一：本地开发（推荐）

这是一个本地开发项目，直接在项目目录中开发使用：

```bash
# 1. 安装依赖
npm install

# 2. 构建项目
npm run build

# 3. 直接运行示例脚本
npm run simple -- --provider 'openAI' --name 'Jo' --location 'New York, NY'
```

### 方式二：在其他项目中使用本地包

#### 方案 A：作为子目录 + npm link（推荐）

如果你的项目结构是这样的：
```
your-project/
├── package.json
├── src/
└── agents-Aipyq/    # 把 agents-Aipyq 放在这里
    ├── package.json
    └── ...
```

使用步骤：

```bash
# 1. 在 agents-Aipyq 目录中构建并创建链接
cd agents-Aipyq
npm install
npm run build
npm link

# 2. 在你的主项目中链接这个包
cd ..
npm link @aipyq/agents
```

#### 方案 B：作为子目录 + 直接路径安装

```bash
# 在你的项目根目录中
npm install ./agents-Aipyq

# 或者使用绝对路径
npm install /absolute/path/to/agents-Aipyq
```

#### 方案 C：使用 npm link（跨目录）

```bash
# 1. 在 agents-Aipyq 目录中
cd /path/to/agents-Aipyq
npm install
npm run build
npm link

# 2. 在你的项目目录中
cd /path/to/your-project
npm link @aipyq/agents
```

### 方式三：发布到 npm（需要修改包名）

**注意**：当前包名 `@aipyq/agents` 包含大写字母，npm 不再允许。如果要发布，需要修改包名：

1. 修改 `package.json` 中的 `name` 为小写，例如：`@aipyq/agents`
2. 然后发布：`npm publish`

## 基本使用

### 1. 环境配置

首先，在项目根目录创建 `.env` 文件，配置相应的 API 密钥：

```env
# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# Google
GOOGLE_API_KEY=your_google_api_key

# 其他提供商...
```

### 2. 最简单的示例

```typescript
import { Run } from '@aipyq/agents';
import { HumanMessage } from '@langchain/core/messages';
import { getLLMConfig } from '@aipyq/agents/utils/llmConfig';
import { Providers } from '@aipyq/agents';

async function simpleExample() {
  // 1. 获取 LLM 配置
  const llmConfig = getLLMConfig(Providers.OPENAI); // 或 Providers.ANTHROPIC, Providers.GOOGLE 等

  // 2. 创建 Run 实例
  const run = await Run.create({
    runId: 'my-run-id',
    graphConfig: {
      type: 'standard',
      llmConfig,
      instructions: 'You are a helpful AI assistant.',
    },
    returnContent: true,
  });

  // 3. 准备消息
  const messages = [new HumanMessage('你好，请介绍一下你自己')];

  // 4. 处理消息流
  const config = {
    configurable: {
      user_id: 'user-123',
      thread_id: 'conversation-1',
    },
    streamMode: 'values',
    version: 'v2' as const,
  };

  const contentParts = await run.processStream({ messages }, config);
  
  // 5. 获取响应消息
  const responseMessages = run.getRunMessages();
  console.log(responseMessages);
}

simpleExample();
```

### 3. 使用工具（Tools）

```typescript
import { Run, Calculator } from '@aipyq/agents';
import { HumanMessage } from '@langchain/core/messages';
import { getLLMConfig } from '@aipyq/agents/utils/llmConfig';
import { Providers } from '@aipyq/agents';

async function withTools() {
  const llmConfig = getLLMConfig(Providers.OPENAI);

  const run = await Run.create({
    runId: 'tool-example',
    graphConfig: {
      type: 'standard',
      llmConfig,
      tools: [new Calculator()], // 添加计算器工具
      instructions: 'You are a helpful assistant with access to a calculator.',
    },
    returnContent: true,
  });

  const messages = [new HumanMessage('请计算 123 + 456 的结果')];

  const config = {
    configurable: {
      user_id: 'user-123',
      thread_id: 'conversation-1',
    },
    streamMode: 'values',
    version: 'v2' as const,
  };

  await run.processStream({ messages }, config);
  const responseMessages = run.getRunMessages();
  console.log(responseMessages);
}

withTools();
```

### 4. 流式响应处理

```typescript
import { Run, GraphEvents, ChatModelStreamHandler } from '@aipyq/agents';
import { HumanMessage } from '@langchain/core/messages';
import { getLLMConfig } from '@aipyq/agents/utils/llmConfig';
import { Providers } from '@aipyq/agents';

async function streamingExample() {
  const llmConfig = getLLMConfig(Providers.OPENAI);

  // 创建自定义事件处理器
  const customHandlers = {
    [GraphEvents.CHAT_MODEL_STREAM]: new ChatModelStreamHandler(),
    [GraphEvents.TOOL_END]: {
      handle: (event: string, data: any) => {
        console.log('工具调用完成:', data);
      },
    },
  };

  const run = await Run.create({
    runId: 'streaming-example',
    graphConfig: {
      type: 'standard',
      llmConfig,
      instructions: 'You are a helpful assistant.',
    },
    returnContent: true,
    customHandlers,
  });

  const messages = [new HumanMessage('请写一首关于春天的诗')];

  const config = {
    configurable: {
      user_id: 'user-123',
      thread_id: 'conversation-1',
    },
    streamMode: 'values',
    version: 'v2' as const,
  };

  await run.processStream({ messages }, config);
}

streamingExample();
```

### 5. 多代理系统（Multi-Agent）

```typescript
import { Run, Providers, GraphEvents } from '@aipyq/agents';
import { HumanMessage } from '@langchain/core/messages';
import { getLLMConfig } from '@aipyq/agents/utils/llmConfig';

async function multiAgentExample() {
  const llmConfig = getLLMConfig(Providers.OPENAI);

  // 定义多个代理
  const agents = [
    {
      agentId: 'researcher',
      provider: Providers.OPENAI,
      clientOptions: llmConfig,
      instructions: 'You are a research assistant. Focus on gathering information.',
    },
    {
      agentId: 'analyst',
      provider: Providers.OPENAI,
      clientOptions: llmConfig,
      instructions: 'You are an analyst. Focus on analyzing data.',
    },
  ];

  // 定义代理之间的连接
  const edges = [
    { from: 'researcher', to: 'analyst' },
  ];

  const run = await Run.create({
    runId: 'multi-agent-example',
    graphConfig: {
      type: 'multi-agent',
      agents,
      edges,
    },
    returnContent: true,
  });

  const messages = [new HumanMessage('请研究并分析 AI 的最新发展趋势')];

  const config = {
    configurable: {
      user_id: 'user-123',
      thread_id: 'conversation-1',
    },
    streamMode: 'values',
    version: 'v2' as const,
  };

  await run.processStream({ messages }, config);
}

multiAgentExample();
```

## 支持的 LLM 提供商

- **OpenAI**: `Providers.OPENAI`
- **Anthropic**: `Providers.ANTHROPIC`
- **Google**: `Providers.GOOGLE`
- **Azure OpenAI**: `Providers.AZURE`
- **AWS Bedrock**: `Providers.BEDROCK`
- **Mistral**: `Providers.MISTRAL`
- **DeepSeek**: `Providers.DEEPSEEK`
- **OpenRouter**: `Providers.OPENROUTER`
- **Vertex AI**: `Providers.VERTEXAI`
- **XAI**: `Providers.XAI`

## 可用的工具（Tools）

- `Calculator`: 计算器工具
- `CodeExecutor`: 代码执行工具
- `ProgrammaticToolCalling`: 编程式工具调用
- `ToolSearchRegex`: 正则表达式工具搜索

## 运行示例脚本

项目包含多个示例脚本，可以通过 npm scripts 运行：

```bash
# 简单示例
npm run simple -- --provider 'openAI' --name 'Jo' --location 'New York, NY'

# 使用工具
npm run tool -- --provider 'openAI' --name 'Jo' --location 'New York, NY'

# 流式响应
npm run stream -- --provider 'anthropic' --name 'Jo' --location 'New York, NY'

# 多代理测试
npm run multi-agent-test

# 代码执行
npm run code_exec -- --provider 'openAI' --name 'Jo' --location 'New York, NY'
```

## 主要 API

### `Run.create(config)`

创建 Run 实例。

**参数：**
- `runId`: 运行 ID（必需）
- `graphConfig`: 图配置
  - `type`: 'standard' 或 'multi-agent'
  - `llmConfig`: LLM 配置
  - `tools`: 工具数组（可选）
  - `instructions`: 系统指令
  - `agents`: 代理数组（多代理模式）
  - `edges`: 代理连接（多代理模式）
- `returnContent`: 是否返回内容（默认 false）
- `customHandlers`: 自定义事件处理器（可选）

### `run.processStream(inputs, config)`

处理消息流。

**参数：**
- `inputs`: 输入对象，包含 `messages` 数组
- `config`: 配置对象
  - `configurable`: 可配置项（user_id, thread_id 等）
  - `streamMode`: 流模式（'values'）
  - `version`: 版本（'v2'）

### `run.getRunMessages()`

获取运行过程中的所有消息。

### `run.generateTitle(options)`

生成对话标题。

## 事件系统

框架支持多种事件类型，可以通过 `customHandlers` 注册处理器：

- `GraphEvents.CHAT_MODEL_STREAM`: 模型流式输出
- `GraphEvents.TOOL_START`: 工具开始执行
- `GraphEvents.TOOL_END`: 工具执行完成
- `GraphEvents.ON_MESSAGE_DELTA`: 消息增量更新
- `GraphEvents.ON_RUN_STEP`: 运行步骤更新
- 等等...

## 更多示例

查看 `src/scripts/` 目录下的示例文件：
- `simple.ts`: 简单使用示例
- `tools.ts`: 工具使用示例
- `stream.ts`: 流式响应示例
- `multi-agent-*.ts`: 多代理系统示例
- `code_exec.ts`: 代码执行示例

## 构建和开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式构建
npm run build:dev

# 运行测试
npm test

# 代码格式化
npm run format

# 代码检查
npm run lint
```

## 注意事项

1. 确保设置了正确的环境变量（API 密钥等）
2. 不同提供商可能需要不同的配置参数
3. 某些功能（如流式响应）需要特定的提供商支持
4. 多代理系统需要仔细设计代理之间的连接关系


