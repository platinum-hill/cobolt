// Library of custom tool call definitions for the Ollama API
import { Tool, ToolCall } from "ollama";
import { RequestContext } from "./query_engine";
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
interface McpTool {
    type: "mcp",
    server: string,
    mcpFunction: FunctionMcpToolCallWrapper,
    toolDefinition: Tool
}

// Define FunctionTool as a union of the two specific types
type FunctionTool = McpTool;

export { FunctionMcpToolCallWrapper, FunctionTool, McpTool }