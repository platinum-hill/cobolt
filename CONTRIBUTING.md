# Contributing to Cobolt

Thank you for your interest in contributing to Cobolt! This document provides guidelines and instructions to help you get started.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Creating a New Feature](#creating-a-new-feature)
- [Fixing a Bug](#fixing-a-bug)
- [Testing](#testing)
- [Code Style and Linting](#code-style-and-linting)
- [Git Hooks](#git-hooks)

## Development Environment Setup

Dependencies required to build the application include:
- Node.js (v22.14.0)
- npm or yarn
- Python 3.x.x (For electron builder/ node-gyp)
- Xcode Command Line Tools (For electron builder/ node-gyp) (MacOS)
- Visual Studio (For electron builder/ node-gyp) (Windows

>[!Note]
> Cobolt uses electron-builder to build native dependencies against the current electron version. This uses node-gyp under the hood which requires Python and platform specific C++ compiler

1. **Install Python**

    Download the platform specific python installer from [here](https://devguide.python.org/versions/)

2. **Set up C++ build tools**
    
    **Windows**

     Install Visual C++ Build Environment: For Visual Studio 2019 or later, use the `Desktop development with C++` workload from [Visual Studio Community](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community). From the workload, make sure to install a Windows 10 SDK

    **MacOS**

    Install the `Xcode Command Line Tools` standalone by running `xcode-select --install`. -- OR --
    Alternatively, if you already have the [full Xcode installed](https://developer.apple.com/xcode/download/), you can install the Command Line Tools under the menu `Xcode -> Open Developer Tool -> More Developer Tools...`.



3. **Install Node.js**:

    **MacOs**
   ```bash
   brew install nvm
   nvm install 22.14.0
   node --version  # Verify installation
   ```

   **Windows**

    ```bash
    # in a powershell terminal
    winget install --id=CoreyButler.NVMforWindows -e
    nvm install 22.14.0
    node --version  # Verify installation
    ```

4. **Clone the repository**:
   ```bash
   git clone https://github.com/platinum-hill/cobolt.git
   cd cobolt
   ```

5. **Install dependencies**:
   ```bash
   npm install
   ```

6. **Start development server**:
   ```bash
   npm run start
   ```

7. **Build for production**:
   ```bash
   npm run package
   ```

The built application will be available in `release/build/<target>/`.

## Creating a New Feature

1. **Create a new branch** from the `main` branch:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/your-feature-name
   ```

2. **Develop your feature** following our coding standards.

3. **Write tests** for your feature.

4. **Run the application locally**:
   ```bash
   npm run start
   ```

5. **Commit your changes** with descriptive commit messages:

   We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `style:` for code style changes (formatting, etc.)
   - `refactor:` for code refactoring
   - `test:` for adding or modifying tests
   - `chore:` for maintenance tasks

## Fixing a Bug

1. **Create a new branch** from the `main` branch:
   ```bash
   git checkout main
   git pull
   git checkout -b fix/bug-description
   ```

2. **Fix the bug** and add tests to prevent regression.

3. **Verify that all tests pass**:
   ```bash
   npm run test:all
   ```

## Testing

We use Jest for testing. Run tests with:

```bash
# Run all tests
npm run test:all

# Run backend tests only
npm run test:backend

# Run specific tests
npm run test
```

When contributing, please:
- Write tests for new features
- Ensure existing tests pass
- Add regression tests for bug fixes

## Code Style and Linting

We use ESLint and Prettier to maintain code quality and consistency:

```bash
# Run linter
npm run lint

# Fix linting issues automatically
npm run lint:fix
```

Our pre-commit hooks will automatically check your code before commits. Make sure your code passes these checks.

## Git Hooks

We uses [Husky](https://typicode.github.io/husky/get-started.html)  to enforce code quality checks:

Pre-commit hook: Automatically runs lint-staged to format and lint files before committing
Pre-push hook: Runs tests and type checking before pushing to the remote

These hooks help maintain code quality and prevent pushing code with failing tests.

You don't need to do anything special to use these hooks. They will run automatically when you commit or push code to this repository.

In exceptional scenarios if you need to bypass these hooks use the `--no-verify` option with your git commands.
##
Thank you for contributing to Cobolt! 