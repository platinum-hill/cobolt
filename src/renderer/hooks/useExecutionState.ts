import { useState, useEffect } from 'react';
import { executionStore, ExecutionEvent, MessageExecutionState } from '../stores/executionStore';

// Hook to subscribe to execution state changes
export const useExecutionState = () => {
  const [state, setState] = useState<MessageExecutionState>(executionStore.getAllState());

  useEffect(() => {
    const unsubscribe = executionStore.subscribe(() => {
      setState(executionStore.getAllState());
    });

    return unsubscribe;
  }, []);

  return {
    executionState: state,
    getMessageExecutionState: (messageId: string) => executionStore.getMessageExecutionState(messageId),
    addExecutionEvent: (event: ExecutionEvent) => executionStore.addExecutionEvent(event),
    updateExecutionEvent: (eventId: string, updates: Partial<ExecutionEvent>) => executionStore.updateExecutionEvent(eventId, updates),
    clearMessageState: (messageId: string) => executionStore.clearMessageState(messageId)
  };
};

// Hook for a specific message's execution state
export const useMessageExecutionState = (messageId: string) => {
  const { executionState, getMessageExecutionState } = useExecutionState();
  
  return getMessageExecutionState(messageId);
};
