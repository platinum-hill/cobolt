import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream } from './generators/simple_ollama_stream';
import { createChatPrompt, createQueryWithToolsPrompt } from './prompt_templates';
import { searchMemories, isMemoryEnabled } from './memory';
import { FunctionTool } from './ollama_tools';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';
import { ConductorGenerator } from './generators/conductor_generator';
import { OnlineGenerator } from './generators/online_generator';

/**
 * Main query engine that handles AI chat requests and tool usage
 * Routes between simple chat and conductor-based tool execution
 * Manages shared concerns: memory, datetime formatting, and prompt creation
 */
class QueryEngine {
  private conductorGenerator: ConductorGenerator;
  private onlineGenerator: OnlineGenerator;
  
  constructor() {
    this.conductorGenerator = new ConductorGenerator();
    this.onlineGenerator = new OnlineGenerator();
  }

  /**
   * Process a simple chat query without tools
   */
  async processChatQuery(
    requestContext: RequestContext,
    memories: string,
    chatSystemPrompt: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'chat_relevant_memories', memories);
    TraceLogger.trace(requestContext, 'processChatQuery', chatSystemPrompt);

    return this.wrappedStream(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
      cancellationToken
    );
  }

  /**
   * Process an online query using ai-sdk with tool calling
   */
  async processOnlineQuery(
    requestContext: RequestContext,
    memories: string,
    chatSystemPrompt: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'online_relevant_memories', memories);
    TraceLogger.trace(requestContext, 'processOnlineQuery', chatSystemPrompt);

    return this.onlineGenerator.createOnlineResponseGenerator(
      requestContext,
      chatSystemPrompt,
      memories,
      cancellationToken
    );
  }

  /**
   * Process a query with tools using the conductor generator
   */
  async processToolsQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    memories: string,
    chatSystemPrompt: string,
    toolSystemPrompt: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'conductor_relevant_memories', memories);
    
    return this.conductorGenerator.createConductorResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolSystemPrompt,
      toolCalls, 
      memories, 
      cancellationToken
    );
  }

  /**
   * Wrap a stream generator with cancellation check and error handling
   */
  private async *wrappedStream(
    stream: AsyncGenerator<string>,
    cancellationToken: CancellationToken
  ): AsyncGenerator<string> {
    try {
      for await (const chunk of stream) {
        if (cancellationToken.isCancelled) {
          return;
        }
        yield chunk;
      }
    } catch (error) {
      console.error('Error in wrapped stream:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield `\nError in stream: ${errorMessage}`;
    }
  }

  /**
   * Main query method that routes to appropriate processing based on chat mode
   * Handles all shared logic: memory retrieval, datetime formatting, and prompt creation
   */
  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' | 'ONLINE' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    // Extract common logic once at the top level
    const formattedDateTime = formatDateTime(requestContext.currentDatetime).toString();
    const memories = isMemoryEnabled() ? await searchMemories(requestContext.question) : "";
    const chatSystemPrompt = createChatPrompt(formattedDateTime);
    
    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      const toolSystemPrompt = createQueryWithToolsPrompt(formattedDateTime);
      return this.processToolsQuery(requestContext, toolCalls, memories, chatSystemPrompt, toolSystemPrompt, cancellationToken);
    }

    if (chatMode === 'ONLINE') {
      return this.processOnlineQuery(requestContext, memories, chatSystemPrompt, cancellationToken);
    }

    return this.processChatQuery(requestContext, memories, chatSystemPrompt, cancellationToken);
  }
}

export const queryEngineInstance = new QueryEngine();
export { QueryEngine };