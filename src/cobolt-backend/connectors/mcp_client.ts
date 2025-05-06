import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import dotenv from "dotenv";
import { MCPServer, mcpServers } from "./mcp_tools";
import { RequestContext, TraceLogger } from "../logger";
import { ToolCall } from "ollama";
import { McpTool } from "../ollama_tools";
import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { CancellationToken, globalCancellationToken } from '../utils/cancellation';
import { log } from "electron-log/main";

// Load environment variables from .env file
dotenv.config();

class MCPClient {
    private clients: Client[];
    toolCache: McpTool[];
    lastConnectionErrors: any[] = []; 

    constructor() {
        this.clients = [];
        this.toolCache = [];
        this.lastConnectionErrors = [];
    }

    async installMcpServer() {
        // TODO: Implement MCP server installation
    }

    /**
     * Connects to all MCP servers defined in the JSON configuration file.
     * Updates the toolCache with the connected clients.
     * @returns An object with connection status and any errors encountered
     */
    async connectToSevers() {
        let atLeastOneSuccess = false;
        const errors: any[] = [];

        for (const server of mcpServers) {
            try {
                await this.connectToMcpServer(server);
                atLeastOneSuccess = true;
            } catch (error) {
                log.error(`Failed to connect to MCP server ${server.name}:`, error);
                errors.push({
                    serverName: server.name,
                    serverCommand: `${server.command} ${server.args.join(' ')}`,
                    error: error instanceof Error ? 
                        { message: error.message, stack: error.stack } : 
                        { message: String(error) }
                });
                // Continue to the next server instead of throwing immediately
                continue;
            }
        }

        // Store the errors for later reference
        this.lastConnectionErrors = errors;

        // update toolCache with the connected clients
        if (atLeastOneSuccess) {
            this.toolCache = await this.listAllConnectedTools();
        }

        return {
            success: atLeastOneSuccess,
            errors: errors,
            errorMessage: !atLeastOneSuccess && errors.length > 0 
                ? "Failed to connect to any MCP server" 
                : undefined
        };
    }

    private async connectToMcpServer(server: MCPServer) {
        const client = new Client({ name: server.name, version: "0.0.1" });

        const args = [...server.args]

        // Create a custom environment with the current process env plus our custom vars
        // Cast to Record<string, string> to ensure all values are strings
        const customEnv: Record<string, string> = Object.entries(process.env).reduce((acc, [key, value]) => {
            if (value !== undefined) {
                acc[key] = value;
            }
            return acc;
        }, {} as Record<string, string>);

        if (server.env) {
            // Add server-specific environment variables, overriding any existing ones
            Object.entries(server.env).forEach(([key, value]) => {
                customEnv[key] = value;
            });
        }

        const transport = new StdioClientTransport({
            command: server.command,
            args,
            env: customEnv // Pass the environment variables to the child process
        });

        await client.connect(transport);
        this.clients.push(client);
        log.info(`Connected to MCP server ${server.name}`);
    }

    private async listAllConnectedTools(): Promise<McpTool[]> {
        const tools: McpTool[] = [];
        for (const client of this.clients) {
            const toolsResult = await this.listTools(client);
            tools.push(...toolsResult);
        }
        return tools;
    }

    private async listTools(client: Client): Promise<McpTool[]> {
        try {
            const toolsResult = await client.listTools();

            const functionTools = toolsResult.tools.map((tool) => {
                const ollamaInputSchema = tool.inputSchema || {};
                const required = Array.isArray(ollamaInputSchema.required) ? ollamaInputSchema.required : [];
                const properties = ollamaInputSchema.properties || {};

                // Convert Ollama inputSchema properties to MCP format
                const mcpProperties: { [key: string]: { type: string; description: string; enum?: string[] } } = {};

                Object.entries(properties).forEach(([key, prop]: [string, any]) => {
                    mcpProperties[key] = {
                        type: prop.type || 'string',
                        description: prop.description || ''
                    };

                    if (prop.enum) {
                        mcpProperties[key].enum = prop.enum;
                    }
                });

                const functionTool: McpTool = {
                    type: "mcp",
                    server: client.getServerVersion()?.name || '', // when can this fail ?
                    mcpFunction: async (requestContext: RequestContext, toolCall: ToolCall,
                        cancellationToken: CancellationToken = globalCancellationToken) => {
                        TraceLogger.trace(requestContext, "Tool called", toolCall.function.name);

                        if (cancellationToken?.isCancelled) {
                            TraceLogger.trace(requestContext, "tool-call-cancelled",
                                `Tool call ${tool.name} cancelled by user request`);
                            return {
                                content: [{
                                    type: "text",
                                    text: `Operation cancelled: ${tool.name}`
                                }],
                                isError: true
                            };
                        }

                        try {
                            // Call the actual MCP tool function
                            const result = await client.callTool({
                                name: tool.name,
                                arguments: toolCall.function.arguments || '{}'
                            });

                            // Format the result to match the expected CallToolResult type
                            return result as CallToolResult;
                        } catch (error: any) {
                            TraceLogger.trace(requestContext, "error-calling-tool", error);
                            return {
                                content: [{
                                    type: "text",
                                    text: `Error calling tool ${tool.name}: ${error.message || String(error)}`
                                }],
                                isError: true
                            };
                        }
                    },
                    toolDefinition: {
                        type: "function",
                        function: {
                            name: tool.name,
                            description: tool.description || '',
                            parameters: {
                                type: "object",
                                required: required,
                                properties: mcpProperties
                            },
                        }
                    }
                };
                return functionTool;
            });

            return functionTools;
        } catch (error) {
            log.error(`Failed to list tools for ${client}:`, error);
            throw error;
        }
    }
}

const McpClient = new MCPClient();

export { McpClient };