import React, { useState, useEffect } from 'react';
import ReactModal from 'react-modal';
import './ErrorDialog.css';

function ErrorDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<string | undefined>('');
  const [isModelDownload, setIsModelDownload] = useState(false);

  useEffect(() => {
    const handleErrorDialog = (data: any) => {
      setTitle(data.title);
      setMessage(data.message);
      setIsModelDownload(data.isModelDownload || false);

      // Format detailed error information based on error type
      let formattedDetail = data.detail || '';

      // For MCP connection errors, add helpful context
      if (data.title.includes('MCP Connection') && data.mcpErrorDetails) {
        const configHelp =
          '\n\nYou can edit the MCP servers configuration file from Settings to fix this issue.';
        formattedDetail = data.mcpErrorDetails + configHelp;
      }

      // For MCP config errors, add recovery instructions
      if (data.title.includes('MCP Config') && data.configErrorDetails) {
        formattedDetail = `${data.configErrorDetails}\n\nYou may need to fix or recreate the MCP configuration file. MCP Servers will not work till this is fixed.`;
      }

      setDetail(formattedDetail);
      setIsOpen(true);
    };

    window.api.onErrorDialog(handleErrorDialog);

    return () => {
      window.api.removeErrorDialogListener();
    };
  }, []);

  const handleClose = () => {
    // Don't allow closing during model downloads unless it's a completion message
    if (
      isModelDownload &&
      !title.includes('Models Ready') &&
      !title.includes('Error')
    ) {
      return;
    }
    setIsOpen(false);
  };

  // Auto-close success messages after a delay
  useEffect(() => {
    if (isOpen && title.includes('Models Ready')) {
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, title]);

  return (
    <ReactModal
      isOpen={isOpen}
      className={`ErrorModal ${isModelDownload ? 'model-download' : ''}`}
      overlayClassName="ErrorOverlay"
      closeTimeoutMS={300}
      ariaHideApp={false}
      onRequestClose={handleClose}
      shouldCloseOnEsc={!isModelDownload || title.includes('Models Ready')}
      shouldCloseOnOverlayClick={
        !isModelDownload || title.includes('Models Ready')
      }
    >
      <div className="error-modal-header">
        <h2 style={{ color: isModelDownload ? '#4caf50' : '#E53935' }}>
          {title}
        </h2>
        {(!isModelDownload ||
          title.includes('Models Ready') ||
          title.includes('Error')) && (
          <button className="close-button" type="button" onClick={handleClose}>
            X
          </button>
        )}
      </div>
      <div className="error-modal-content">
        <p className="error-message">{message}</p>
        {detail && (
          <div className="error-detail">
            <pre>{detail}</pre>
          </div>
        )}
      </div>
      <div className="button-container">
        {(!isModelDownload ||
          title.includes('Models Ready') ||
          title.includes('Error')) && (
          <button
            type="button"
            className={`ok-button ${isModelDownload && title.includes('Models Ready') ? 'success' : ''}`}
            onClick={handleClose}
          >
            OK
          </button>
        )}
        {isModelDownload &&
          !title.includes('Models Ready') &&
          !title.includes('Error') && (
            <div style={{ color: '#8a9ba8', fontStyle: 'italic' }}>
              Please wait...
            </div>
          )}
      </div>
    </ReactModal>
  );
}

export default ErrorDialog;
