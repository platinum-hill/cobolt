import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

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

// Load from JSON file
const appDataPath = app.getPath('userData');
const configPath = path.resolve(appDataPath, 'mcp-servers.json');
let configJson: MCPServersConfig;

try {
    if (fs.existsSync(configPath)) {
        configJson = JSON.parse(fs.readFileSync(configPath, 'utf8')) as MCPServersConfig;
    } else {
        // Create empty config file
        configJson = { mcpServers: {} };
        fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2), 'utf8');
    }
} catch (error) {
    console.error(`Error reading or creating config file: ${error}`);
    configJson = { mcpServers: {} };
}

const mcpServers: MCPServer[] = Object.entries(configJson.mcpServers).map(([key, server]) => ({
    name: key,
    command: server.command,
    args: server.args,
    ...(server.env ? { env: server.env } : {})
}));

export { MCPServer, mcpServers };