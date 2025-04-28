import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { queryOllamaWithTools, simpleChatOllamaStream } from './ollama_client';
import { createChatPrompt, createQueryWithToolsPrompt, createQueryWithToolResponsePrompt } from './prompt_templates';
import { searchMemories } from './memory';
import { FunctionTool } from './ollama_tools';
import { Message } from 'ollama';
import  { ChatHistory } from './chat_history';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';

class QueryEngine {
  /**
   * V1 RAT | RAG query pipeline
   * @param requestContext 
   * @returns 
   */
  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Perform initial query with tool descriptions
    const memories = await searchMemories(requestContext.question)
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    TraceLogger.trace(requestContext, 'processRagRatQuery-question', requestContext.question);
    TraceLogger.trace(requestContext, 'processRagRatQuery-memories_retrieved', memories);
    const toolUseSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString());
    const response = await queryOllamaWithTools(requestContext, toolUseSystemPrompt, toolCalls, memories);
    if (cancellationToken.isCancelled) {
      return this.emptyCancelledStream(cancellationToken);
    }
    
    // if there are no tool calls, 
    // return a simple chat response based on the original prompt
    if (!response.message.tool_calls) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tool calls requested');
      const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
      return this.wrappedStream(
        simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
        cancellationToken);
    }
    const toolMessages: Message[] = [];

    // Handle tool calls. Use tools to get the relevant documents
    // As of now these tools only do deterministic filtering
    for (const toolCall of response.message.tool_calls) {
      if (cancellationToken.isCancelled) {
        TraceLogger.trace(requestContext, 'tool_execution_cancelled', 
          'Tool execution cancelled by user request');
        break;
      }
      
      const toolName = toolCall.function.name;
      const tool = toolCalls.find((tool) => tool.toolDefinition.function.name === toolName);
      if (!tool) {
        continue
      }

      if (tool.type === "mcp") {
        const toolResponse = await tool.mcpFunction(requestContext, toolCall);

        if (toolResponse.isError) {
          TraceLogger.trace(requestContext, `
            processRagRatQuery-${toolName}`, `tool call failed`);
          continue;
        }
        if (!toolResponse.content) {
          TraceLogger.trace(requestContext, `
            processRagRatQuery-${toolName}`, `tool call returned no content`);
          continue;
        }

        // Check if it's a text content
        for (const item of toolResponse.content) {
          if (item.type === "text") {
            toolMessages.push({ role: 'tool', content: createQueryWithToolResponsePrompt(toolName, item.text as string) });
          }
        }
      }
    }

    // If none of the requested tools returned any valid documents
    // prompt ollama again informing it of the tool request failure
    if (toolMessages.length === 0) {
      TraceLogger.trace(requestContext, 'processRagRatQuery', 'no tools returned documents');
      const toolCallFailedSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString());
      return simpleChatOllamaStream(requestContext, toolCallFailedSystemPrompt, memories);
    }

    // create tool prompts for the final query
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    return this.wrappedStream(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, memories, toolMessages),
      cancellationToken
    );
  }

  async processChatQuery(
    requestContext: RequestContext,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    const relevantMemories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'chat_relevant_memories', relevantMemories);
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    TraceLogger.trace(requestContext, 'processChatQuery', chatSystemPrompt);

    return this.wrappedStream(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, relevantMemories),
      cancellationToken
    );
  }

  /**
   * Wrap a stream generator with cancellation check
   */
  private async *wrappedStream(
    stream: AsyncGenerator<string>,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    try {
      for await (const chunk of stream) {
        if (cancellationToken.isCancelled) {
          TraceLogger.trace({ requestId: "cancelled", currentDatetime: new Date(), question: "", chatHistory: new ChatHistory() }, 
            'stream_cancelled', 'User cancelled the request');
          break;
        }
        yield chunk;
      }
    } finally {
      // Ensure we don't leave the token in cancelled state
      cancellationToken.reset();
    }
  }

  private async *emptyCancelledStream(cancellationToken: CancellationToken): AsyncGenerator<string> {
    // We still need to reset the token
    try {
      yield "Operation cancelled";
    } finally {
      cancellationToken.reset();
    }
  }

  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));

    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQuery(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

const queryEngineInstance = new QueryEngine();

// TODO: replace this with actual tests
if (require.main === module) {
  (async () => {
    const chatMode = 'CONTEXT_AWARE';
    const requestContext: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Why is the sky blue?',
      requestId: "test-request-id",
    };
    const stream = await queryEngineInstance.query(requestContext, chatMode);
    if (!stream) {
      process.exit(1);
    }
    // eslint-disable-next-line no-restricted-syntax
    let output = "";
    let isFirstToken = true;
    for await (const chunk of stream) {
      if (isFirstToken) {
        output += chunk;
        isFirstToken = false;
        TraceLogger.trace(requestContext, 'response_to_user_ttft', output);
      } else {
        output += chunk;
      }
    }
    TraceLogger.trace(requestContext, 'response_to_user_complete', output);
  })();
}

export { QueryEngine, queryEngineInstance };

