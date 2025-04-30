import * as fs from 'fs';
import * as path from 'path';
import {
  RequestContext,
  TraceLogger,
} from '../../../src/cobolt-backend/logger';
import { ChatHistory } from '../../../src/cobolt-backend/chat_history';

// Mock electron-log module
jest.mock('electron-log/main', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock electron app module
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue(path.join(process.cwd(), 'logs')),
  },
}));

// Import TraceLogger after mocking dependencies

// Mock fs module
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

describe('TraceLogger', () => {
  // Save original static properties
  const originalCsvPath = (TraceLogger as any).csvPath;
  const originalHeaders = new Set((TraceLogger as any).headers);
  const originalRequestData = new Map((TraceLogger as any).requestData);
  const originalInitialized = (TraceLogger as any).initialized;
  const testDir = path.join(process.cwd(), 'test_logs');
  const testCsvPath = path.join(testDir, 'test_trace.csv');

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock fs functions
    (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === testDir) return true;
      if (filePath === testCsvPath) return false;
      return false;
    });

    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.readFileSync as jest.Mock).mockImplementation(() => '');
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});

    // Reset static state
    (TraceLogger as any).csvPath = testCsvPath;
    (TraceLogger as any).initialized = false;
    (TraceLogger as any).headers = new Set(['requestId', 'timestamp']);
    (TraceLogger as any).requestData = new Map();
  });

  afterEach(() => {
    // Restore original state
    (TraceLogger as any).csvPath = originalCsvPath;
    (TraceLogger as any).initialized = originalInitialized;
    (TraceLogger as any).headers = originalHeaders;
    (TraceLogger as any).requestData = originalRequestData;
  });

  test('Basic logging with simple values', () => {
    // Test 1: Basic logging with simple values
    const test1Id = 'test-basic';
    const requestContext1: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Basic test',
      requestId: test1Id,
    };

    TraceLogger.trace(requestContext1, 'process1', 'simple value');
    TraceLogger.trace(requestContext1, 'process2', 42);

    // Verify the data was stored correctly
    const requestMap = (TraceLogger as any).requestData.get(test1Id);
    expect(requestMap).toBeDefined();
    expect(requestMap.get('process1')).toBe('simple value');
    expect(requestMap.get('process2')).toBe(42);

    // Verify headers were updated
    const { headers } = TraceLogger as any;
    expect(headers.has('process1')).toBe(true);
    expect(headers.has('process2')).toBe(true);
    expect(headers.has('process1_elapsed_ms')).toBe(true);
    expect(headers.has('process2_elapsed_ms')).toBe(true);

    // Verify writeFileSync was called
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('Values with newlines', () => {
    // Test 2: Values with newlines
    const test2Id = 'test-newlines';
    const requestContext2: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Newline test',
      requestId: test2Id,
    };

    const multilineValue = 'Line 1\nLine 2\nLine 3';
    TraceLogger.trace(requestContext2, 'multiline', multilineValue);
    TraceLogger.trace(requestContext2, 'process', 'After multiline');

    // Verify the data was stored correctly
    const requestMap = (TraceLogger as any).requestData.get(test2Id);
    expect(requestMap).toBeDefined();
    expect(requestMap.get('multiline')).toBe(multilineValue);
    expect(requestMap.get('process')).toBe('After multiline');
  });

  test('Values with quotes and commas', () => {
    // Test 3: Values with quotes and commas
    const test3Id = 'test-quotes';
    const requestContext3: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Quote test',
      requestId: test3Id,
    };

    const quotedValue = 'Value with "quotes"';
    const commaValue = 'Value, with, commas';
    const bothValue = 'Value, with "quotes" and, commas';

    TraceLogger.trace(requestContext3, 'quoted', quotedValue);
    TraceLogger.trace(requestContext3, 'commas', commaValue);
    TraceLogger.trace(requestContext3, 'both', bothValue);

    // Verify the data was stored correctly
    const requestMap = (TraceLogger as any).requestData.get(test3Id);
    expect(requestMap).toBeDefined();
    expect(requestMap.get('quoted')).toBe(quotedValue);
    expect(requestMap.get('commas')).toBe(commaValue);
    expect(requestMap.get('both')).toBe(bothValue);
  });

  test('Complex case with quotes, newlines, and commas', () => {
    // Test 4: Complex case with quotes, newlines, and commas
    const test4Id = 'test-complex';
    const requestContext4: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Complex test',
      requestId: test4Id,
    };

    const complexValue =
      'Line 1, with "quotes"\nLine 2, also with "quotes"\nLine 3';
    const doubleQuotesValue = 'Value with ""double quotes""';

    TraceLogger.trace(requestContext4, 'complex', complexValue);
    TraceLogger.trace(requestContext4, 'escaped_quotes', doubleQuotesValue);

    // Verify the data was stored correctly
    const requestMap = (TraceLogger as any).requestData.get(test4Id);
    expect(requestMap).toBeDefined();
    expect(requestMap.get('complex')).toBe(complexValue);
    expect(requestMap.get('escaped_quotes')).toBe(doubleQuotesValue);
  });

  test('Updating existing rows', () => {
    // Test 5: Updating existing rows
    const test1Id = 'test-basic';
    const test2Id = 'test-newlines';

    const requestContext1: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Basic test',
      requestId: test1Id,
    };

    const requestContext2: RequestContext = {
      currentDatetime: new Date(),
      chatHistory: new ChatHistory(),
      question: 'Newline test',
      requestId: test2Id,
    };

    // Initial values
    TraceLogger.trace(requestContext1, 'process1', 'simple value');
    TraceLogger.trace(requestContext2, 'multiline', 'Line 1\nLine 2\nLine 3');

    // Updated values
    const updatedValue = 'updated value';
    const updatedMultiline = 'Updated\nMultiline\nValue';

    TraceLogger.trace(requestContext1, 'process1', updatedValue);
    TraceLogger.trace(requestContext2, 'multiline', updatedMultiline);

    // Verify the data was updated correctly
    const requestMap1 = (TraceLogger as any).requestData.get(test1Id);
    const requestMap2 = (TraceLogger as any).requestData.get(test2Id);

    expect(requestMap1).toBeDefined();
    expect(requestMap2).toBeDefined();
    expect(requestMap1.get('process1')).toBe(updatedValue);
    expect(requestMap2.get('multiline')).toBe(updatedMultiline);
  });

  test('CSV file creation and headers', () => {
    // Mock that the directory exists but the file doesn't
    (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === path.join(process.cwd(), 'logs')) return true;
      if (filePath === path.join(process.cwd(), 'logs', 'trace.csv'))
        return false;
      return false;
    });

    // Initialize the logger
    TraceLogger.init();

    // Verify the directory was checked
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join(process.cwd(), 'logs'),
    );

    // Verify the file existence was checked
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join(process.cwd(), 'logs', 'trace.csv'),
    );

    // Verify headers were written
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect((TraceLogger as any).initialized).toBe(true);
  });

  test('Initialization for evaluation mode', () => {
    const evalId = 'test-eval-123';
    const expectedPath = path.join(
      process.cwd(),
      'logs',
      `eval_${evalId}_trace.csv`,
    );

    TraceLogger.initForEvaluation(evalId);

    expect((TraceLogger as any).mode).toBe('evaluation');
    expect((TraceLogger as any).csvPath).toBe(expectedPath);
    expect((TraceLogger as any).initialized).toBe(true);
  });
});
