## Overview

<div align="center">
  <img src="https://github.com/platinum-hill/cobolt/blob/main/assets/icon.png" width="128" height="128" alt="Cobolt Logo">
</div>

This is a cross-platform desktop application that allows you to chat with ollama hosted models via a clean UI and use features like Memory, Conversation History and with extensible capabilities through a Model Context Protocol (MCP) framework.

## Features

- **⚙️ Model Selection:** Chat with any Ollama supported model.
- **🕰️ Conversation History:** Revisit and review past chats easily.
- **🧠 Memory:** Retain context across conversations.
- **🔌 Extensibility:** Built-in support for the Model Context Protocol (MCP) framework.
- **🖥️ Cross-platform**: Runs on both macOS and Windows.

## 🚀 Usage

1. Launch the application
2. Select your preferred model
3. Start chatting!

## 🛠 Development

**First time setup:** Install nvm and use that to install the latest stable LTS node version

On MacOS
```bash
brew install nvm
nvm install --lts
node --version # check what version of node was installed
```

Install development and runtime node dependencies:
```bash
npm install
```

Start the debug application using:
```bash
npm run start
```

To produce the final release build run:
```bash
npm run package
```

The built application is located under the corresponding directory under the `release/build/<target>/` directory.

## 🤝 Contributing

We welcome contributions!
Please open a Pull Request (PR) for any improvements or features. All submissions will be reviewed and merged into the main branch.

## 📄 License

This project is licensed under the Apache 2.0 License.
