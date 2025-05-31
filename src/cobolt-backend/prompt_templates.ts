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

Current Date & Time: ${currentDateTime}.`;
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
Current Date & Time: ${currentDateTime}.`
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
  return `The following is a response from a tool ${toolName}. response: ${toolResponse}.`
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
Current Date & Time: ${currentDateTime}.
query: ${query}
${memoriesSection}
Previously requested tools: ${toolNames.join(', ')}
`
}

/**
 * Generates a planning prompt for an LLM to select and parameterize tool calls for a user task.
 *
 * @param currentDateTime - The current date and time as an ISO string.
 * @param question - The user's task or question.
 * @returns A prompt string instructing the LLM to return a JSON object with tool calls.
 *
 * @example
 * const prompt = createPlanPrompt('2025-05-25T12:00:00Z', 'Get my emails from last week');
 */
function createPlanPrompt(
  currentDateTime: string,
): string {
  return `You are a specialized "planner" AI. Your task is to analyze the user's request from the chat messages and create either:
1. A detailed step-by-step plan (if you have enough information) on behalf of user that another "executor" AI agent can follow, or
2. A list of clarifying questions (if you do not have enough information) prompting the user to reply with the needed clarifications
Current Date & Time: ${currentDateTime}.

## Guidelines
1. Check for clarity and feasibility
  - If the user's request is ambiguous, incomplete, or requires more information, respond only with all your clarifying questions in a concise list.
  - If available tools are inadequate to complete the request, outline the gaps and suggest next steps or ask for additional tools or guidance.
2. Create a detailed plan
  - Once you have sufficient clarity, produce a step-by-step plan that covers all actions the executor AI must take.
  - Number the steps, and explicitly note any dependencies between steps (e.g., “Use the output from Step 3 as input for Step 4”).
  - Include any conditional or branching logic needed (e.g., “If X occurs, do Y; otherwise, do Z”).
3. Provide essential context
  - The executor AI will see only your final plan (as a user message) or your questions (as an assistant message) and will not have access to this conversation's full history.
  - Therefore, restate any relevant background, instructions, or prior conversation details needed to execute the plan successfully.
4. One-time response
  - You can respond only once.
  - If you respond with a plan, it will appear as a user message in a fresh conversation for the executor AI, effectively clearing out the previous context.
  - If you respond with clarifying questions, it will appear as an assistant message in this same conversation, prompting the user to reply with the needed clarifications.
5. Keep it action oriented and clear
  - In your final output (whether plan or questions), be concise yet thorough.
  - The goal is to enable the executor AI to proceed confidently, without further ambiguity.`
}

export {
  createPlanPrompt,
  createChatPrompt,
  createQueryWithToolsPrompt,
  createQueryWithToolResponsePrompt,
  createQueryToolFailure
};
