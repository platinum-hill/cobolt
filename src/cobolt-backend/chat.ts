import * as readline from 'readline';
import { queryEngineInstance } from './query_engine';
import { RequestContext } from './logger';
import  { ChatHistory } from './chat_history';

async function main() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    console.log("Chat with AI (type 'exit' to quit)");
    console.log("Available modes: chat, contextaware");
    console.log("Usage: /mode <mode> to switch modes (e.g. /mode contextaware)");
  
    const askQuestion = (): Promise<string> => {
      return new Promise((resolve) => {
        rl.question("You: ", (input) => {
          resolve(input.trim());
        });
      });
    };

    let currentMode: 'CHAT' | 'CONTEXT_AWARE' = 'CHAT';
    const chatHistory = new ChatHistory();
  
    try {
      for (;;) {
        const userInput = await askQuestion();
  
        if (userInput.toLowerCase() === "exit") {
          console.log("Goodbye!");
          rl.close();
          break;
        }

        if (userInput.startsWith('/mode ')) {
          const mode = userInput.slice(6).toUpperCase();
          if (['CHAT', 'CONTEXT_AWARE'].includes(mode)) {
            currentMode = mode as 'CHAT' | 'CONTEXT_AWARE';
            console.log(`Switched to ${currentMode} mode`);
            continue;
          } else {
            console.log("Invalid mode. Available modes: chat, contextaware");
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

        console.log("AI: ");
        let response = "";
        const stream = await queryEngineInstance.query(requestContext, currentMode);
        
        for await (const chunk of stream) {
          process.stdout.write(chunk);
          response += chunk;
        }
        console.log("\n");
        
        chatHistory.addAssistantMessage(response);
      }
    } catch (error) {
      console.error("An error occurred:", error);
      rl.close();
    }
  }

  main().catch(console.error);
  