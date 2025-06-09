import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream } from './simple_ollama_stream';
import { createChatPrompt, createQueryWithToolsPrompt } from './prompt_templates';
import { searchMemories } from './memory';
import { FunctionTool } from './ollama_tools';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';
import { ConductorGenerator } from './generators/conductor_generator';
import { SequentialGenerator } from './generators/sequential_generator';

class QueryEngine {
  private conductorGenerator: ConductorGenerator;
  private sequentialGenerator: SequentialGenerator;
  
  constructor() {
    this.conductorGenerator = new ConductorGenerator();
    this.sequentialGenerator = new SequentialGenerator();
  }
  
  /**
   * Clear executed tool tracking for a specific request or all requests
   */
  public clearExecutedTools(requestId?: string): void {
    this.sequentialGenerator.clearExecutedTools(requestId);
  }

  /**
   * Check if conductor mode is enabled
   */
  private async isConductorModeEnabled(): Promise<boolean> {
    // Import here to avoid circular dependency
    const { default: appMetadata } = await import('./data_models/app_metadata');
    return appMetadata.getConductorEnabled();
  }

  async processConductorQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Get RAG memories
    const memories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'conductor_relevant_memories', memories);
    
    // Use chat prompt
    const toolSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString())
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    
    return this.conductorGenerator.createConductorResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolSystemPrompt,
      toolCalls, 
      memories, 
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

  async processRagRatQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    // Check if conductor mode is enabled
    const conductorEnabled = await this.isConductorModeEnabled();
    
    if (conductorEnabled) {
      // Use conductor flow instead of regular RAG
      return this.processConductorQuery(requestContext, toolCalls, cancellationToken);
    }
    
    // Regular RAG flow
    const memories = await searchMemories(requestContext.question);
    TraceLogger.trace(requestContext, 'chat_relevant_memories', memories);
    
    // Use tool prompt
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    const toolSystemPrompt = createQueryWithToolsPrompt(formatDateTime(requestContext.currentDatetime).toString())
    
    return this.sequentialGenerator.createSequentialResponseGenerator(
      requestContext, 
      chatSystemPrompt,
      toolSystemPrompt,
      toolCalls,
      memories,
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

  async query(
    requestContext: RequestContext,
    chatMode: 'CHAT' | 'CONTEXT_AWARE' | 'CONDUCTOR' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    if (chatMode === 'CONTEXT_AWARE' || chatMode === 'CONDUCTOR') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processRagRatQuery(requestContext, toolCalls, cancellationToken);
    }

    return this.processChatQuery(requestContext, cancellationToken);
  }
}

export const queryEngineInstance = new QueryEngine();
export { QueryEngine };