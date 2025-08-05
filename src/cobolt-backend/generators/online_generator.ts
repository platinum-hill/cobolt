import { RequestContext, TraceLogger } from '../logger';
import { FunctionTool } from '../ollama_tools';
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { streamText, tool, stepCountIs, Tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { McpClient } from '../connectors/mcp_client';
import { McpToolDefinition } from '../ollama_tools';
import log from 'electron-log/main';
import { zodSchemaToString } from '../utils/debug_utils';

/**
 * Online generator that uses ai-sdk for tool calling
 * Converts MCP tools to ai-sdk format and handles streaming responses
 */

export class OnlineGenerator {
  
  /**
   * Convert MCP tools to ai-sdk tool format
   */
  private convertMcpToolsToAiSdk(mcpTools: FunctionTool[], requestContext: RequestContext) {
    const aiSdkTools: Record<string, Tool<any, any>> = {};
    
    for (const mcpTool of mcpTools) {
      const toolName = mcpTool.toolDefinition.function.name;
      
      // Convert MCP tool parameters to Zod schema
      const McptoolDefinition = mcpTool.toolDefinition;
      const zodSchema = this.convertMcpParametersToZod(McptoolDefinition);

      // Create a properly typed tool definition
      // @ts-ignore
      const toolDefinition = tool({
        description: mcpTool.toolDefinition.function.description,
        inputSchema: zodSchema,
        execute: async (args: any): Promise<string> => {
            try {
              log.info(`[OnlineGenerator] Executing tool ${toolName} with args:`, args);
              
              // Create a mock ToolCall for MCP compatibility
              const toolCall = {
                function: {
                  name: toolName,
                  arguments: args
                }
              };
              
              // Execute the MCP tool - returns CallToolResult
              const result = await mcpTool.mcpFunction(
                requestContext,
                toolCall
              );
              
              // Handle CallToolResult structure
              if (result.isError) {
                // Extract error message from content
                const errorText = result.content
                  .map(content => content.type === 'text' ? content.text : '')
                  .join(' ')
                  .trim();
                throw new Error(errorText || 'Tool execution failed');
              }
              
              // Extract text content from successful result
              const textContent = result.content
                .map(content => {
                  if (content.type === 'text') {
                    return content.text;
                  }
                  // Handle other content types like images, etc.
                  return `[${content.type} content]`;
                })
                .join('\n');
              
              return textContent || 'Tool executed successfully with no text output';
            } catch (error) {
              log.error(`[OnlineGenerator] Error executing tool ${toolName}:`, error);
              return `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
        });
        
        // Create tool using the ai-sdk tool function
        aiSdkTools[toolName] = toolDefinition;
    }
    
    return aiSdkTools;
  }
  
  /**
   * Convert MCP parameters to Zod schema compatible with ai-sdk
   */
  private convertMcpParametersToZod(mcpToolDefinition: McpToolDefinition): z.ZodTypeAny {
    const mcpParameters = mcpToolDefinition.function.parameters;

    // Inline conversion for each property (array/object/enum support)
    const toZod = (property: any): z.ZodTypeAny => {
      // Handle union types
      if (Array.isArray(property.type)) {
        return z.union(property.type.map(
          (t: string) => toZod({ ...property, type: t })
        ) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
          .describe(property.description ?? '');
      }

      // Handle individual simple types
      switch (property.type) {
        case 'string':
          return property.enum && property.enum.length
            ? (z.enum(property.enum as [string, ...string[]]) as z.ZodTypeAny).describe(property.description ?? '')
            : z.string().describe(property.description ?? '');
        case 'number':
          return z.number().describe(property.description ?? '');
        case 'integer':
          return z.number().int().describe(property.description ?? '');
        case 'boolean':
          return z.boolean().describe(property.description ?? '');
        case 'array':
          return z.array(
            property.items
              ? toZod(property.items)
              : z.string() // Default to string array if no items specified
          ).describe(property.description ?? '');
        case 'object':
          return z.object({}).passthrough().describe(property.description ?? '');
        case 'null':
          return z.null().describe(property.description ?? '');
        default:
          return z.any().describe(property.description ?? '');
      }
    };

    // Build the input schema object
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    const required = mcpParameters.required || [];
    for (const [key, def] of Object.entries(mcpParameters.properties)) {
      schemaFields[key] = required.includes(key)
        ? toZod(def)
        : toZod(def).optional();
    }
    
    return z.object(schemaFields);
  }
  
  /**
   * Create a streaming response using ai-sdk with tool calling
   */
  async *createOnlineResponseGenerator(
    requestContext: RequestContext,
    systemPrompt: string,
    memories: string,
    cancellationToken: CancellationToken = globalCancellationToken
  ): AsyncGenerator<string> {
    try {
      TraceLogger.trace(requestContext, 'online_system_prompt', systemPrompt);
      TraceLogger.trace(requestContext, 'online_memories', memories);
      
      // Get available MCP tools
      const mcpTools: FunctionTool[] = McpClient.toolCache;
      const aiSdkTools: Record<string, Tool<any, any>> = this.convertMcpToolsToAiSdk(mcpTools, requestContext);
      // Object.entries(aiSdkTools).forEach(([name, tool]) => {
      //   log.info(`[OnlineGenerator] Available tool: ${name}`);
      //   log.info(`[OnlineGenerator] Input schema: ${JSON.stringify(zodSchemaToString(tool.inputSchema))}`);
      // });

      // Build messages array
      const messages: any[] = [];
      
      // Add memories if available
      if (memories) {
        messages.push({
          role: 'system',
          content: `Relevant memories: ${memories}`
        });
      }
      
      // Add chat history
      if (requestContext.chatHistory.length > 0) {
        const ollamaMessages = requestContext.chatHistory.toOllamaMessages();
        for (const msg of ollamaMessages) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
          });
        }
      }
      
      // Add current user question
      messages.push({
        role: 'user',
        content: requestContext.question
      });
      
      // Get OpenAI API key from environment
      const apiKey = process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        yield "Error: OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.";
        return;
      }
      
      // Create OpenAI provider with API key
      const openaiProvider = createOpenAI({
        apiKey: apiKey,
      });
      
      log.info(`[OnlineGenerator] Starting streaming with fullStream`);

      // Use fullStream to handle all chunk types directly  
      const result = await streamText({
        model: openaiProvider('gpt-4.1-mini'),
        system: systemPrompt,
        messages,
        tools: aiSdkTools,
        stopWhen: stepCountIs(5), // stop after 5 steps if tools were called
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          if (toolCalls && toolCalls.length > 0) {
            log.info(`[OnlineGenerator] Step finished with ${toolCalls.length} tool calls`);
          }
        }
      });

      // Iterate over fullStream to handle all chunk types
      for await (const chunk of result.fullStream) {
        if (cancellationToken.isCancelled) {
          log.info('[OnlineGenerator] Generation cancelled');
          return;
        }

        // log.info(`[OnlineGenerator] Chunk received: ${JSON.stringify(chunk)}`);
        if (chunk.type === 'text-delta') {
          yield chunk.text;
        } else if (chunk.type === 'tool-call') {
          log.info(`[OnlineGenerator] Tool call: ${chunk.toolName}`);
          yield `\n[Using tool: ${chunk.toolName}]\n`;
        } else if (chunk.type === 'reasoning-delta') {
          log.info(`[OnlineGenerator] Reasoning chunk: ${chunk.text}`);
          // Optionally include reasoning in output
          yield chunk.text;
        } else if (chunk.type === 'finish-step') {
          log.info(`[OnlineGenerator] Step finished`);
          // Step finish events don't need to be yielded
        } else if (chunk.type === 'finish') {
          log.info(`[OnlineGenerator] Stream finished`);
          // Final finish event
        } else if (chunk.type === 'error') {
          log.error(`[OnlineGenerator] Error in stream: ${chunk.error}`);
          yield `\nError ${chunk.error}`;
          return;
        }
      }
      
    } catch (error) {
      log.error('[OnlineGenerator] Error in online generator:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
    }
  }
}
