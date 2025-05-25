/**
 * Rewrites a user search query to be clearer and more specific, generating 2-3 alternative phrasings.
 * Intended to improve search engine performance while maintaining the original intent.
 *
 * @param question - The original user search query.
 * @returns A prompt string for an LLM to generate alternative queries.
 *
 * @example
 * const prompt = createQueryPrompt('How do I fix a TypeError in JavaScript?');
 */
function createQueryPrompt(question: string): string {
  return `Rewrite the following search query to be more clear and specific, focusing on the user's likely intent.
Maintain the core meaning but improve search engine performance. Generate 2-3 alternative phrasings of this question and nothing else. You do not need to explain yourself.

Original Query: ${question}

Rewritten Query: `;
}


/**
 * Generates a planning prompt for an LLM to select and parameterize tool calls for a user task.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @param question - The user's task or question.
 * @param toolsDocstring - Documentation string describing available tools and their parameters.
 * @returns A prompt string instructing the LLM to return a JSON object with tool calls.
 *
 * @example
 * const prompt = createPlanPrompt(
 *   '2025-05-25T12:00:00Z',
 *   'Get my emails from last week',
 *   'get_emails(date_from, date_to), get_calendar_events(event_start, event_end)'
 * );
 */
function createPlanPrompt(
  currentDateTime: string,
  question: string,
  toolsDocstring: string,
): string {
  return `user: ${question}

Generate the necessary tool calls to complete the described task.

## Response Format:
Return only a JSON object with the required tool and parameters. Follow these rules:
1. Use only the provided tools and parameters.
2. Do not include any comments, explanations, and assumptions.
3. If no tools are needed, return an empty JSON object \`{}\`.
4. Each tool may be used only once.
5. Do not use unlisted tools. Available tools are get_emails and get_calendar_events.
6. When applying multiple conditions to the same parameter, use $and or $or as appropriate to group them explicitly.
7. The response must contain only the JSON output—nothing else.

${toolsDocstring}

### **JSON Format:**
\`\`\`json
{ "<tool_name>": { <parameter>: <value> } }
\`\`\`

#### **Examples:**
Single filter:
\`\`\`json
{ "get_emails": { "date_from": "2025-02-20T00:00:00.000Z" } }
\`\`\`

Multiple filters:
\`\`\`json
{ "get_emails": { "date_from": "2025-02-20T00:00:00.000Z", "date_to": "2025-02-25T00:00:00.000Z", "from": "jack@gmail.com" },
   "get_calendar_events": { "event_start": "2025-02-20T00:00:00.000Z", "event_end": "2025-02-25T00:00:00.000Z" }
}
\`\`\`
Ensure only relevant parameters are included. **Do not make assumptions.**

Current Date & Time: ${currentDateTime}


A: `;
}

/**
 * Creates a prompt for a helpful AI assistant to answer user questions in a chat context.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @returns A prompt string for the LLM to answer as a helpful assistant.
 *
 * @example
 * const prompt = createChatPrompt('2025-05-25T12:00:00Z');
 */
function createChatPrompt(
  currentDateTime: string,
): string {
  return `You are a helpful AI assistant. Answer the following questions based on the query and memories if applicable. Your responses should be:
1. Clear and concise
2. Accurate and well-reasoned
3. Helpful and practical
4. Professional yet friendly

Current Date & Time: ${currentDateTime}.

`;
}

/**
 * Creates a prompt for a Retrieval-Augmented Generation (RAG) scenario, using context and optional user memories.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @param question - The user's question.
 * @param context - The retrieved context to answer the question.
 * @param memories - Optional user memories to supplement the answer.
 * @returns A prompt string for the LLM to answer using context and memories.
 *
 * @example
 * const prompt = createRagPrompt('2025-05-25T12:00:00Z', 'What is my next meeting?', 'You have a meeting at 3pm.', '');
 */
function createRagPrompt(
  currentDateTime: string,
  question: string,
  context: string,
  memories: string,
): string {
  const memoriesSection = memories ? `User Memories: ${memories}` : '';
  
  return `You are a helpful AI assistant. Use the following context${memories ? ' and memories' : ''} to answer the question.
If you cannot find the answer in the context, summarize the context itself and end by saying "I cannot find the answer in the provided context."

Current Date & Time: ${currentDateTime}.

Context:
${context}

${memoriesSection}

user: ${question}

A: `;
}

/**
 * Creates a prompt instructing the LLM to determine which tools to use for a query, considering user memories.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @returns A prompt string for the LLM to select tools.
 *
 * @example
 * const prompt = createQueryWithToolsPrompt('2025-05-25T12:00:00Z');
 */
function createQueryWithToolsPrompt( 
  currentDateTime: string): string {
  return `
    Your job is to determine the tools to be used to answer the query below. Only use the tools provided to you if you feel they are necessary. You can also use the user's memories to help determine the arguments for the tool calls.
    Current Date & Time: ${currentDateTime}
    `
}

/**
 * Creates a prompt to provide the LLM with a tool's response for further processing.
 *
 * @param toolName - The name of the tool that was called.
 * @param toolResponse - The response returned by the tool.
 * @returns A prompt string for the LLM to use the tool's response.
 *
 * @example
 * const prompt = createQueryWithToolResponsePrompt('get_emails', '{"emails": []}');
 */
function createQueryWithToolResponsePrompt(toolName: string, toolResponse: string): string {
  return `
    The following is a response from a tool ${toolName}. response: ${toolResponse}.`
}

/**
 * Creates a prompt for the LLM to answer a query when tool calls have failed, optionally using user memories.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @param query - The original user query.
 * @param toolNames - Array of tool names that failed.
 * @param memories - Optional user memories to help answer the query.
 * @returns A prompt string for the LLM to answer without tool usage.
 *
 * @example
 * const prompt = createQueryToolFailure('2025-05-25T12:00:00Z', 'Show my calendar', ['get_calendar_events'], '');
 */
function createQueryToolFailure(
  currentDateTime: string,
  query: string,
  toolNames: string[],
  memories: string
  ): string {
  const memoriesSection = memories ? `User Memories: ${memories}` : '';
  
  return `You are a helpful AI assistant. Your request to get data from the following tools for the original query failed. Please respond to the original query provided below without the use of any tools.${memories ? ' You can also use the user\'s memories to answer the query.' : ''}
  Current Date & Time: ${currentDateTime}
  query: ${query}
  ${memoriesSection}
  Previously requested tools: ${toolNames.join(', ')}
  `
}


export {
  createQueryPrompt,
  createPlanPrompt,
  createChatPrompt,
  createRagPrompt,
  createQueryWithToolsPrompt,
  createQueryWithToolResponsePrompt,
  createQueryToolFailure
};
