// Library of custom tool call definitions for the Ollama API
import { ToolCall } from "ollama";
import { RequestContext } from "./logger";
import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { CancellationToken } from "./utils/cancellation";
/* Interface for a function that wraps a tool call
    @param input: The tool call to be executed  
    @param params: Additional parameters required call the tool    
*/
interface FunctionMcpToolCallWrapper {
    (requestContext: RequestContext, input: ToolCall, cancellationToken?: CancellationToken): Promise<CallToolResult>
}

/* interface for a function tool
    @param function: A function wrapper that uses tool call information from ollama and executes the function
    @param toolDefinition: Ollama Tool definition
*/

// Definining a new interface for MCP tool definitions. The Ollama API tools defnition has everything as optionl. We don't want to handle that again because we already do that when we fetch Mcp too list
interface McpToolDefinition {
    type: "function",
    function: {
        name: string,
        description: string,
        parameters: {
            type: string,
            required: string[],
            properties: Record<string, {
                type: string | string [],
                items?: any,
                description: string,
                enum?: string[]
            }>;
        };
    };
}

interface McpTool {
    type: "mcp",
    server: string,
    mcpFunction: FunctionMcpToolCallWrapper,
    toolDefinition: McpToolDefinition
}

// Define FunctionTool as a union of the two specific types
type FunctionTool = McpTool;

export { FunctionMcpToolCallWrapper, FunctionTool, McpTool, McpToolDefinition };