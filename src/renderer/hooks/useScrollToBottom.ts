import { useRef, useEffect } from 'react';

/**
 * Custom hook for auto-scrolling to the bottom of a container
 * @returns Ref to attach to the element that should be scrolled into view
 */
const useScrollToBottom = (messages: any[]) => {
  const ref = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    // We specifically want to scroll when messages change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  return { ref, scrollToBottom };
};

export default useScrollToBottom;
