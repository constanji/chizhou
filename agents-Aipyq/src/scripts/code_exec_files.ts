// src/scripts/cli.ts
import { config } from 'dotenv';
config();
import { HumanMessage, BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type * as t from '@/types';
import { ChatModelStreamHandler, createContentAggregator } from '@/stream';
import {
  ToolEndHandler,
  ModelEndHandler,
  createMetadataAggregator,
} from '@/events';
import { getLLMConfig } from '@/utils/llmConfig';
import { getArgs } from '@/scripts/args';
import { GraphEvents } from '@/common';
import { Run } from '@/run';
import { createCodeExecutionTool } from '@/tools/CodeExecutor';

const conversationHistory: BaseMessage[] = [];

async function testCodeExecution(): Promise<void> {
  const { userName, location, provider, currentDate } = await getArgs();
  const { contentParts, aggregateContent } = createContentAggregator();
  const customHandlers = {
    [GraphEvents.TOOL_END]: new ToolEndHandler(),
    [GraphEvents.CHAT_MODEL_END]: new ModelEndHandler(),
    [GraphEvents.CHAT_MODEL_STREAM]: new ChatModelStreamHandler(),
    [GraphEvents.ON_RUN_STEP_COMPLETED]: {
      handle: (
        event: GraphEvents.ON_RUN_STEP_COMPLETED,
        data: t.StreamEventData
      ): void => {
        console.log('====== ON_RUN_STEP_COMPLETED ======');
        console.dir(data, { depth: null });
        aggregateContent({
          event,
          data: data as unknown as { result: t.ToolEndEvent },
        });
      },
    },
    [GraphEvents.ON_RUN_STEP]: {
      handle: (
        event: GraphEvents.ON_RUN_STEP,
        data: t.StreamEventData
      ): void => {
        console.log('====== ON_RUN_STEP ======');
        console.dir(data, { depth: null });
        aggregateContent({ event, data: data as t.RunStep });
      },
    },
    [GraphEvents.ON_RUN_STEP_DELTA]: {
      handle: (
        event: GraphEvents.ON_RUN_STEP_DELTA,
        data: t.StreamEventData
      ): void => {
        console.log('====== ON_RUN_STEP_DELTA ======');
        console.dir(data, { depth: null });
        aggregateContent({ event, data: data as t.RunStepDeltaEvent });
      },
    },
    [GraphEvents.ON_MESSAGE_DELTA]: {
      handle: (
        event: GraphEvents.ON_MESSAGE_DELTA,
        data: t.StreamEventData
      ): void => {
        console.log('====== ON_MESSAGE_DELTA ======');
        console.dir(data, { depth: null });
        aggregateContent({ event, data: data as t.MessageDeltaEvent });
      },
    },
    [GraphEvents.TOOL_START]: {
      handle: (
        _event: string,
        data: t.StreamEventData,
        metadata?: Record<string, unknown>
      ): void => {
        console.log('====== TOOL_START ======');
        console.dir(data, { depth: null });
      },
    },
  };

  const llmConfig = getLLMConfig(provider);

  const run = await Run.create<t.IState>({
    runId: 'message-num-1',
    graphConfig: {
      type: 'standard',
      llmConfig,
      tools: [createCodeExecutionTool()],
      instructions:
        'You are a friendly AI assistant with coding capabilities. Always address the user by their name.',
      additional_instructions: `The user's name is ${userName} and they are located in ${location}. The current date is ${currentDate}.`,
    },
    returnContent: true,
    customHandlers,
  });

  const config: Partial<RunnableConfig> & {
    version: 'v1' | 'v2';
    run_id?: string;
    streamMode: string;
  } = {
    configurable: {
      provider,
      thread_id: 'conversation-num-1',
    },
    streamMode: 'values',
    version: 'v2' as const,
    // recursionLimit: 3,
  };

  console.log('Test 1: Create Project Plan');

  const userMessage1 = `
  Hi ${userName} here. We are testing your file capabilities.
  
  1. Create a text file named "project_plan.txt" that contains: "This is a project plan for a new software development project."
  
  Please generate this file so I can review it.
  `;

  conversationHistory.push(new HumanMessage(userMessage1));

  let inputs = {
    messages: conversationHistory,
  };
  const finalContentParts1 = await run.processStream(inputs, config);
  const finalMessages1 = run.getRunMessages();
  if (finalMessages1) {
    conversationHistory.push(...finalMessages1);
  }
  console.log('\n\n====================\n\n');
  console.dir(contentParts, { depth: null });

  console.log('Test 2: Edit Project Plan');

  const userMessage2 = `
  Thanks for creating the project plan. Now I'd like you to edit the same plan to:
  
  1. Add a new section called "Technology Stack" that contains: "The technology stack for this project includes the following technologies" and nothing more.
  
`;

  // Make sure to pass the file ID of the previous file you created and explicitly duplicate or rename the file in your code so we can then access it. Also print the contents of the new file to ensure we did what we wanted.`;

  conversationHistory.push(new HumanMessage(userMessage2));

  inputs = {
    messages: conversationHistory,
  };
  const finalContentParts2 = await run.processStream(inputs, config);
  const finalMessages2 = run.getRunMessages();
  if (finalMessages2) {
    conversationHistory.push(...finalMessages2);
  }
  console.log('\n\n====================\n\n');
  console.dir(contentParts, { depth: null });

  const { handleLLMEnd, collected } = createMetadataAggregator();
  const titleResult = await run.generateTitle({
    provider,
    inputText: userMessage2,
    contentParts,
    chainOptions: {
      callbacks: [
        {
          handleLLMEnd,
        },
      ],
    },
  });
  console.log('Generated Title:', titleResult);
  console.log('Collected metadata:', collected);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.log('Conversation history:');
  console.dir(conversationHistory, { depth: null });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

testCodeExecution().catch((err) => {
  console.error(err);
  console.log('Conversation history:');
  console.dir(conversationHistory, { depth: null });
  process.exit(1);
});
