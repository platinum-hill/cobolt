import log from 'electron-log/main'
import * as fs from 'fs'
import * as path from 'path'
import { parse as csvParse } from 'csv-parse/sync'
import { stringify as csvStringify } from 'csv-stringify/sync'
import  { ChatHistory } from './chat_history'
import { app } from 'electron'
type RequestContext = {
  currentDatetime: Date;
  chatHistory: ChatHistory;
  question: string;
  requestId: string;
}

// Wrapper around electron-log to provide consistent logging interface
class TraceLogger {
  private static csvPath: string = path.join(process.cwd(), 'logs', 'trace.csv')
  private static requestData: Map<string, Map<string, string | number>> = new Map()
  private static headers: Set<string> = new Set(['requestId', 'timestamp'])
  private static initialized: boolean = false
  private static mode: 'default' | 'evaluation' = 'default'

  // Initialize for regular usage (UI)
  static init(): void {
    this.mode = 'default';
    const appDataPath = app.getPath('userData');
    this.csvPath = path.join(appDataPath, 'trace.csv');
    this.initialize();
  }

  public static initForEvaluation(evaluationId: string): void {
    this.mode = 'evaluation';
    this.csvPath = path.join(process.cwd(), 'logs', `eval_${evaluationId}_trace.csv`);
    this.initialize();
  }

  private static initialize(): void {
    if (this.initialized) return;

    // Ensure logs directory exists
    const logsDir = path.dirname(this.csvPath)
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    // Create CSV file with headers if it doesn't exist
    if (!fs.existsSync(this.csvPath)) {
      this.writeHeaders();
    } else {
      // Read existing headers
      try {
        const csvContent = fs.readFileSync(this.csvPath, 'utf8');
        // Parse only the first line to get headers
        if (csvContent.trim()) {
          const lines = csvContent.trim().split('\n');
          if (lines.length > 0) {
            const parsedHeaders = csvParse(lines[0], { columns: false })[0];
            parsedHeaders.forEach((header: string) => this.headers.add(header.trim()));
          }
        }
      } catch {
        // If error reading file, we'll create a new one with default headers
        this.writeHeaders();
      }
    }
    this.initialized = true;
  }

  private static writeHeaders(): void {
    const headers = Array.from(this.headers);
    const headerRow = csvStringify([headers]);
    fs.writeFileSync(this.csvPath, headerRow);
  }

  static trace(requestContext: RequestContext, fieldName: string, fieldValue: string | number): void {
    const elapsed = Date.now() - requestContext.currentDatetime.getTime()
    log.info(`[${requestContext.requestId}] ${elapsed}ms: ${fieldName}: ${fieldValue}`)

    if (!this.initialized) {
      this.init()
    }

    if (!this.requestData.has(requestContext.requestId)) {
      const newData = new Map<string, string>();
      newData.set('requestId', requestContext.requestId);
      newData.set('timestamp', requestContext.currentDatetime.toISOString());
      this.requestData.set(requestContext.requestId, newData);
    }

    const requestMap = this.requestData.get(requestContext.requestId)!;
    requestMap.set(fieldName, fieldValue);

    const elapsedFieldName = `${fieldName}_elapsed_ms`;
    requestMap.set(elapsedFieldName, elapsed.toString());

    // Add new headers if needed
    let headersUpdated = false;
    if (!this.headers.has(fieldName)) {
      this.headers.add(fieldName);
      this.headers.add(elapsedFieldName);
      headersUpdated = true;
    } else if (!this.headers.has(elapsedFieldName)) {
      this.headers.add(elapsedFieldName);
      headersUpdated = true;
    }

    // Update headers in the file if needed
    if (headersUpdated) {
      try {
        // Read existing content
        let existingData: string[][] = [];
        try {
          const csvContent = fs.readFileSync(this.csvPath, 'utf8');
          if (csvContent.trim()) {
            existingData = csvParse(csvContent, { columns: false });
            // Remove header row as we'll write a new one
            if (existingData.length > 0) {
              existingData.shift();
            }
          }
        } catch {
          // TODO: If error reading, we'll just write a new file
        }

        // Write new headers and existing data
        const headers = Array.from(this.headers);
        const headerRow = csvStringify([headers]);
        let dataRows = '';
        if (existingData.length > 0) {
          // Ensure each row has the right number of columns
          const paddedData = existingData.map(row => {
            const paddedRow = [...row];
            while (paddedRow.length < headers.length) {
              paddedRow.push('');
            }
            return paddedRow;
          });
          dataRows = csvStringify(paddedData);
        }
        fs.writeFileSync(this.csvPath, headerRow + dataRows);
      } catch (error) {
        log.error(`Error updating CSV headers: ${error}`);
      }
    }

    // Write the updated row for this request
    this.writeRequestRow(requestContext.requestId);
  }

  private static writeRequestRow(requestId: string): void {
    if (!this.requestData.has(requestId)) return;

    try {
      // Read existing rows
      let rows: string[][] = [];
      try {
        const csvContent = fs.readFileSync(this.csvPath, 'utf8');
        if (csvContent.trim()) {
          rows = csvParse(csvContent, { columns: false });
        }
      } catch {
        // If error reading, we'll just write a new file with this row
        rows = [Array.from(this.headers)];
      }

      // Find if this request already has a row
      const headers = rows.length > 0 ? rows[0] : Array.from(this.headers);
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === requestId) {
          rowIndex = i;
          break;
        }
      }

      // Create the row data
      const requestMap = this.requestData.get(requestId)!;
      const rowData: string[] = [];
      for (const header of headers) {
        rowData.push(requestMap.has(header) ? String(requestMap.get(header)) : '');
      }

      // Update or append the row
      if (rowIndex !== -1) {
        rows[rowIndex] = rowData;
      } else {
        rows.push(rowData);
      }

      // Write back to file
      const csvContent = csvStringify(rows);
      fs.writeFileSync(this.csvPath, csvContent);
    } catch (error) {
      log.error(`Error writing to CSV: ${error}`);
    }
  }
}

export { TraceLogger, RequestContext };
