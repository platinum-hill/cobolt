import { RequestContext, TraceLogger } from './logger';
import { formatDateTime } from './datetime_parser';
import { simpleChatOllamaStream } from './generators/simple_ollama_stream';
import { createChatPrompt, createQueryWithToolsPrompt } from './prompt_templates';
import { searchMemories, isMemoryEnabled } from './memory';
import { FunctionTool } from './ollama_tools';
import { McpClient } from './connectors/mcp_client';
import { CancellationToken, globalCancellationToken } from './utils/cancellation';
import { ConductorGenerator } from './generators/conductor_generator';

class QueryEngine {
  private conductorGenerator: ConductorGenerator;
  
  constructor() {
    this.conductorGenerator = new ConductorGenerator();
  }

  async processChatQuery(
    requestContext: RequestContext,
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'chat_relevant_memories', memories);
    const chatSystemPrompt = createChatPrompt(formatDateTime(requestContext.currentDatetime).toString());
    TraceLogger.trace(requestContext, 'processChatQuery', chatSystemPrompt);

    return this.wrappedStream(
      simpleChatOllamaStream(requestContext, chatSystemPrompt, memories),
      cancellationToken
    );
  }

  async processToolsQuery(
    requestContext: RequestContext,
    toolCalls: FunctionTool[],
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'conductor_relevant_memories', memories);
    
    // Use conductor generator with tools
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
    chatMode: 'CHAT' | 'CONTEXT_AWARE' = 'CHAT',
    cancellationToken: CancellationToken = globalCancellationToken
  ): Promise<AsyncGenerator<string>> {
    TraceLogger.trace(requestContext, 'user_chat_history', requestContext.chatHistory.toString());
    TraceLogger.trace(requestContext, 'user_question', requestContext.question);
    TraceLogger.trace(requestContext, 'current_date', formatDateTime(requestContext.currentDatetime));
    
    // Check memory once at the top level
    const memories = isMemoryEnabled() ? await searchMemories(requestContext.question) : "";
    
    if (chatMode === 'CONTEXT_AWARE') {
      const toolCalls: FunctionTool[] = McpClient.toolCache;
      return this.processToolsQuery(requestContext, toolCalls, memories, cancellationToken);
    }

    return this.processChatQuery(requestContext, memories, cancellationToken);
  }
}

export const queryEngineInstance = new QueryEngine();
export { QueryEngine };