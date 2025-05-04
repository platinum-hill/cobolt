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

## 🛠 Development

### Dependencies

- Node.js (v22.14.0)
- npm or yarn
- Python 3.x.x (For electron builder/ node-gyp)
- Xcode Command Line Tools (For electron builder/ node-gyp) (MacOS)
- Visual Studio (For electron builder/ node-gyp) (Windows)

### Setup

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

    First, install [nvm for windows](https://github.com/coreybutler/nvm-windows)
    ```bash
    # in a powershell terminal
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
