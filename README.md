# Cobolt

<div align="center">
  <img src="https://github.com/platinum-hill/cobolt/blob/main/assets/icon.png" width="128" height="128" alt="Cobolt Logo">
  
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](#)
  [![Version](https://img.shields.io/badge/Version-0.0.1-green.svg)](#)
  [![Downloads](https://img.shields.io/github/downloads/platinum-hill/cobolt/total.svg)](https://github.com/platinum-hill/cobolt/releases)
  [![Build Status](https://github.com/platinum-hill/cobolt/actions/workflows/test.yml/badge.svg)](https://github.com/platinum-hill/cobolt/actions/workflows/build.yml)
  [![Release Status](https://github.com/platinum-hill/cobolt/actions/workflows/publish.yml/badge.svg)](https://github.com/platinum-hill/cobolt/actions/workflows/release.yml)
</div>

<div align="center">
  <h3>📥 Download Latest Release</h3>
  
  [![macOS Download](https://img.shields.io/badge/macOS-Download-blue.svg)](https://github.com/platinum-hill/cobolt/releases/latest/download/Cobolt.dmg)
  [![Windows Download](https://img.shields.io/badge/Windows-Download-blue.svg)](https://github.com/platinum-hill/cobolt/releases/latest/download/Cobolt.exe)
  
  <sub>For other platforms and previous versions, visit our [Releases](https://github.com/platinum-hill/cobolt/releases) page</sub>
</div>

## 🎯 Overview

Cobolt is a powerful, cross-platform desktop application that revolutionizes your interaction with locally hosted AI models. Experience a seamless, intuitive interface while leveraging advanced features like persistent memory and extensible capabilities through the Model Context Protocol (MCP) framework.

## ✨ Key Features

- **🤖 Intelligent Model Selection**
  - Seamlessly switch between any Ollama-supported model
  - Quick model switching without restarting

- **📚 Advanced Memory System**
  - Persistent context retention across conversations
  - Smart memory management
  - Customizable memory settings

- **🔄 Comprehensive History**
  - Full conversation history tracking
  - Easy navigation through past interactions
  - Export and backup capabilities

- **🔌 Extensible Architecture**
  - Built-in Model Context Protocol (MCP) support
  - Plugin system for custom extensions
  - Developer-friendly API

- **🌐 Cross-Platform Support**
  - Native support for macOS and Windows
  - Consistent experience across platforms
  - Regular updates and improvements

## 🛠 Development

### Prerequisites

- Node.js (LTS version)
- npm or yarn
- Git

### Setup

1. **Install Node.js** using nvm:

   ```bash
   # macOS
   brew install nvm
   nvm install --lts
   node --version  # Verify installation
   ```

This project uses node-gyp which requires python and a C++ compiler. Please check the required depencies for your operating system on
[node-gyp docs](https://github.com/nodejs/node-gyp?tab=readme-ov-file#installation)

On MacOS
```bash
brew install nvm
nvm install --lts
node --version # check what version of node was installed
```

3. **Install dependencies**:
   ```bash
   npm install:all
   ```

4. **Start development server**:
   ```bash
   npm run start
   ```

5. **Build for production**:
   ```bash
   npm run package
   ```

The built application will be available in `release/build/<target>/`.

## 🤝 Contributing

Contributions are welcome! Whether it's reporting a bug, suggesting a feature, or submitting a pull request, your help is appreciated. 

Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on how to get started.

You can also:
* [Report a Bug](https://github.com/platinum-hill/cobolt/issues/new?assignees=&labels=bug&template=bug_report.md&title=)
* [Request a Feature](https://github.com/platinum-hill/cobolt/issues/new?assignees=&labels=enhancement&template=feature_request.md&title=)
## 📄 License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

Cobolt builds upon several amazing open-source projects and technologies:

- [Ollama](https://ollama.ai/) - The powerful framework for running large language models locally
- [Model Context Protocol](https://github.com/anthropic/model-context-protocol) - The protocol specification by Anthropic for model context management
- [Mem0](https://github.com/mem0ai/mem0) - The memory management system that inspired our implementation
- [Electron](https://www.electronjs.org/) - The framework that powers our cross-platform desktop application

We're grateful to all the contributors and maintainers of these projects for their incredible work.

---

<div align="center">
  <sub>Built with ❤️ by the Cobolt team</sub>
</div>
