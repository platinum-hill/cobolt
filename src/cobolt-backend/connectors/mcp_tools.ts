import { app } from 'electron';
import Logger from 'electron-log/main';
import * as fs from 'fs';
import * as path from 'path';
import { errorManager } from '../utils/error_manager';

interface MCPServerEnv {
    [key: string]: string;
}

interface MCPServer {
    name: string;
    command: string;
    args: string[];
    env?: MCPServerEnv;
}

interface MCPServersConfig {
    mcpServers: {
        [key: string]: MCPServer;
    };
}

const mcpServers: MCPServer[] = [];

/**
 * Load MCP server configuration from file
 * @returns Result of the operation
 */
function loadConfig() {
    const appDataPath = app.getPath('userData');
    const configPath = path.resolve(appDataPath, 'mcp-servers.json');
    try {
        // Clear existing entries first if reloading
        mcpServers.length = 0;
        
        let configJson: MCPServersConfig;
        
        if (fs.existsSync(configPath)) {
            configJson = JSON.parse(fs.readFileSync(configPath, 'utf8')) as MCPServersConfig;
        } else {
            // Create empty config file
            configJson = { mcpServers: {} };
            fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2), 'utf8');
            Logger.info(`Created new MCP config file at ${configPath}`);
        }
        
        // Populate the servers array
        Object.entries(configJson.mcpServers).forEach(([key, server]) => {
            mcpServers.push({
                name: key,
                command: server.command,
                args: server.args,
                ...(server.env ? { env: server.env } : {})
            });
        });
        
        return { success: true };
    } catch (error) {
        Logger.error(`Error loading MCP config: ${error}`);
        errorManager.reportConfigError(
            'parsing',
            configPath,
            error
        );
        return { success: false, error };
    }
}

// Initialize on module load
loadConfig();

export { MCPServer, mcpServers, loadConfig };