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
        Please wait while we download and install dependencies if needed
        including Ollama, Python, and the local models.
      </p>
      <p>This usually takes 20-25 minutes. We appreciate your patience.</p>
    </div>
  );
}

// Initialize React only if we find the root element
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Loading />);
}
