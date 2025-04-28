const path = require('path');

const mockUserDataPath = '/mock/user/data/path';
const mockConfigPath = path.join(mockUserDataPath, 'mcp-servers.json');
const mockConfigData = { mcpServers: {} };

jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    existsSync: jest.fn().mockImplementation((filePath) => {
      if (filePath === mockConfigPath) {
        return true;
      }
      return originalFs.existsSync(filePath);
    }),
    readFileSync: jest.fn().mockImplementation((filePath, encoding) => {
      if (filePath === mockConfigPath) {
        return JSON.stringify(mockConfigData);
      }
      return originalFs.readFileSync(filePath, encoding);
    }),
  };
});

module.exports = {
  app: {
    getPath: jest.fn().mockImplementation((name) => {
      if (name === 'userData') {
        return mockUserDataPath;
      }
      return '/mock/path';
    }),
  },
};
