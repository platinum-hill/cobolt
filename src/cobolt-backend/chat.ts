import * as readline from 'readline';
import { queryEngineInstance } from './query_engine';
import { RequestContext } from './logger';
import  { ChatHistory } from './chat_history';
import log from 'electron-log/main';

async function main() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    log.info("Chat with AI (type 'exit' to quit)");
    log.info("Available modes: chat, contextaware");
    log.info("Usage: /mode <mode> to switch modes (e.g. /mode contextaware)");
  
    const askQuestion = (): Promise<string> => {
      return new Promise((resolve) => {
        rl.question("You: ", (input) => {
          resolve(input.trim());
        });
      });
    };

    let currentMode: 'CHAT' | 'CONTEXT_AWARE' = 'CONTEXT_AWARE';
    const chatHistory = new ChatHistory();
  
    try {
      for (;;) {
        const userInput = await askQuestion();
  
        if (userInput.toLowerCase() === "exit") {
          log.info("Goodbye!");
          rl.close();
          break;
        }

        if (userInput.startsWith('/mode ')) {
          const mode = userInput.slice(6).toUpperCase();
          if (['CHAT', 'CONTEXT_AWARE'].includes(mode)) {
            currentMode = mode as 'CHAT' | 'CONTEXT_AWARE';
            log.info(`Switched to ${currentMode} mode`);
            continue;
          } else {
            log.info("Invalid mode. Available modes: chat, contextaware");
            continue;
          }
        }
  
        const requestContext: RequestContext = {
          currentDatetime: new Date(),
          chatHistory: chatHistory,
          question: userInput,
          requestId: "sample_user",
        };

        chatHistory.addUserMessage(userInput);

        log.info("AI: ");
        let response = "";
        const stream = await queryEngineInstance.query(requestContext, currentMode);
        
        for await (const chunk of stream) {
          process.stdout.write(chunk);
          response += chunk;
        }
        log.info("\n");
        
        chatHistory.addAssistantMessage(response);
      }
    } catch (error) {
      log.error("An error occurred:", error);
      rl.close();
    }
  }

  main().catch(log.error);
