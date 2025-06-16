// Mock for react-markdown and remark-gfm
const reactMarkdownMock = 'module.exports = ({ children }) => children';

module.exports = {
    projects: [
        // Default configuration for most tests
        {
            preset: 'ts-jest',
            moduleDirectories: [
                'node_modules',
                'release/app/node_modules',
                'src'
            ],
            testMatch: ['<rootDir>/tests/__tests__/App/**/*.test.{js,jsx,ts,tsx}'],
            moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
            moduleNameMapper: {
                '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/tests/mocks/fileMock.js',
                '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
                '^react-markdown$': '<rootDir>/tests/mocks/reactMarkdownMock.js',
                '^remark-gfm$': '<rootDir>/tests/mocks/remarkGfmMock.js',
                '^sqlite3$': '<rootDir>/tests/mocks/sqlite3Mock.js'
            },
            setupFiles: [
                './scripts/check-build-exists.ts'
            ],
            testEnvironment: 'jsdom',
            testEnvironmentOptions: {
                url: 'http://localhost/'
            },
            testPathIgnorePatterns: ['./release/app/dist', './dll', './src/cobolt-backend'],
            transform: {
                '\\.(ts|tsx|js|jsx)$': 'ts-jest',
            },
        },
        // Specific configuration for cobolt-backend tests
        {
            preset: 'ts-jest',
            displayName: 'backend',
            testMatch: ['<rootDir>/tests/__tests__/cobolt-backend/**/*.test.{js,jsx,ts,tsx}'],
            testEnvironment: 'node',
            moduleDirectories: [
                'node_modules',
                'release/app/node_modules',
                'src'
            ],
            moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
            moduleNameMapper: {
                '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/tests/mocks/fileMock.js',
                '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
                '^electron$': '<rootDir>/tests/mocks/electronMock.js',
                '^sqlite3$': '<rootDir>/tests/mocks/sqlite3Mock.js'
            },
            setupFiles: [
                './scripts/check-build-exists.ts'
            ],
            testPathIgnorePatterns: ['./release/app/dist', './dll', './src/cobolt-backend'],
            transform: {
                '^.+\\.[tj]s$': 'ts-jest',
            },
            // Add your specific backend test settings here
            // For example:
            // testTimeout: 15000,
            // setupFiles: ['./src/cobolt-backend/test-setup.js'],
        },
        // Specific configuration for main process tests
        {
            preset: 'ts-jest',
            displayName: 'main',
            testMatch: ['<rootDir>/tests/__tests__/main/**/*.test.{js,jsx,ts,tsx}'],
            testEnvironment: 'node',
            moduleDirectories: [
                'node_modules',
                'release/app/node_modules',
                'src'
            ],
            moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
            moduleNameMapper: {
                '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/tests/mocks/fileMock.js',
                '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
                '^electron$': '<rootDir>/tests/mocks/electronMock.js',
                '^sqlite3$': '<rootDir>/tests/mocks/sqlite3Mock.js'
            },
            setupFiles: [
                './scripts/check-build-exists.ts'
            ],
            testPathIgnorePatterns: ['./release/app/dist', './dll'],
            transform: {
                '^.+\\.[tj]s$': 'ts-jest',
            },
        }
    ]
};

