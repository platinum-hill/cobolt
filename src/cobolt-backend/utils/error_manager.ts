import Logger from 'electron-log/main';

// Error categories
export enum ErrorCategory {
  MCP_CONFIG = 'MCP_CONFIG',
  MCP_CONNECTION = 'MCP_CONNECTION',
  SETUP = 'SETUP',
  RUNTIME = 'RUNTIME',
  DATABASE = 'DATABASE'
}

// Base error structure
export interface AppError {
  category: ErrorCategory;
  timestamp: Date;
  message: string;
  details?: any;
}

// MCP Config specific error
export interface ConfigError extends AppError {
  operation: string;
  path: string;
  error: { message: string; stack?: string };
}

// MCP Connection specific error
export interface ConnectionError extends AppError {
  serverName: string;
  serverCommand: string;
  error: { message: string; stack?: string };
}

class ErrorManager {
  private errors: Map<ErrorCategory, AppError[]> = new Map();

  constructor() {
    // Initialize error categories
    Object.values(ErrorCategory).forEach(category => {
      this.errors.set(category, []);
    });
  }

  // Report a general error
  reportError(category: ErrorCategory, message: string, details?: any): void {
    const error: AppError = {
      category,
      timestamp: new Date(),
      message,
      details
    };
    
    Logger.error(`[${category}] ${message}`);
    if (details) Logger.error(details);
    
    this.addError(error);
  }

  // Report a config error
  reportConfigError(operation: string, path: string, error: Error | any): void {
    const configError: ConfigError = {
      category: ErrorCategory.MCP_CONFIG,
      timestamp: new Date(),
      message: `Error ${operation} config file: ${path}`,
      operation,
      path,
      error: error instanceof Error ? 
        { message: error.message, stack: error.stack } : 
        { message: String(error) }
    };
    
    Logger.error(`Config error: ${configError.message}`);
    this.addError(configError);
  }

  // Report a connection error
  reportConnectionError(serverName: string, serverCommand: string, error: Error | any): void {
    const connectionError: ConnectionError = {
      category: ErrorCategory.MCP_CONNECTION,
      timestamp: new Date(),
      message: `Failed to connect to MCP server ${serverName}`,
      serverName,
      serverCommand,
      error: error instanceof Error ? 
        { message: error.message, stack: error.stack } : 
        { message: String(error) }
    };
    
    Logger.error(`Connection error: ${connectionError.message}`);
    this.addError(connectionError);
  }

  private addError(error: AppError): void {
    const categoryErrors = this.errors.get(error.category) || [];
    categoryErrors.push(error);
    this.errors.set(error.category, categoryErrors);
  }

  // Get errors by category
  getErrors(category: ErrorCategory): AppError[] {
    return this.errors.get(category) || [];
  }

  // Get all errors
  getAllErrors(): Map<ErrorCategory, AppError[]> {
    return this.errors;
  }

  // Clear errors by category
  clearErrors(category: ErrorCategory): void {
    this.errors.set(category, []);
  }

  // Clear all errors
  clearAllErrors(): void {
    Object.values(ErrorCategory).forEach(category => {
      this.errors.set(category, []);
    });
  }

  // Format errors for display based on category
  formatErrors(category: ErrorCategory): string {
    const errors = this.getErrors(category);
    
    if (errors.length === 0) {
      return '';
    }
    
    switch (category) {
      case ErrorCategory.MCP_CONFIG:
        return this.formatConfigErrors(errors as ConfigError[]);
      case ErrorCategory.MCP_CONNECTION:
        return this.formatConnectionErrors(errors as ConnectionError[]);
      default:
        return errors.map(err => `${err.message}`).join('\n\n-------------------\n');
    }
  }

  private formatConfigErrors(errors: ConfigError[]): string {
    return errors
      .map((err) => {
        return `
Operation: ${err.operation} config file
Path: ${err.path}
Error: ${err.error.message || 'Unknown error'}`;
      })
      .join('\n\n-------------------\n');
  }

  private formatConnectionErrors(errors: ConnectionError[]): string {
    return errors
      .map((err) => {
        return `
Server: ${err.serverName}
Command: ${err.serverCommand}
Error: ${err.error.message || 'Unknown error'}`;
      })
      .join('\n\n-------------------\n');
  }
}

export const errorManager = new ErrorManager();