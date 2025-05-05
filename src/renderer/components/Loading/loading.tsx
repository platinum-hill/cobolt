import { createRoot } from 'react-dom/client';
import React from 'react';
import './loading.css';

// Simple Loading component
function Loading() {
  return (
    <div className="loading-container">
      <div className="loading-spinner" />
      <h2>Setting up Cobolt</h2>
      <p>
        Please wait while we install required dependencies if needed (Ollama,
        Python, etc.)
      </p>
      <p>This usually takes a few mins. We appreciate your patience.</p>
    </div>
  );
}

// Initialize React only if we find the root element
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Loading />);
}
