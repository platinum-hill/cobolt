import React, { useState, useEffect } from 'react';
import ReactModal from 'react-modal';
import './ErrorDialog.css';

function ErrorDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<string | undefined>('');

  useEffect(() => {
    // Listen for error messages from the main process
    window.electron.ipcRenderer.on('show-error-dialog', (data: any) => {
      setTitle(data.title);
      setMessage(data.message);
      setDetail(data.detail);
      setIsOpen(true);
    });

    return () => {
      // Clean up listener
      window.electron.ipcRenderer.removeAllListeners('show-error-dialog');
    };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <ReactModal
      isOpen={isOpen}
      className="ErrorModal"
      overlayClassName="ErrorOverlay"
      closeTimeoutMS={300}
      ariaHideApp={false}
      onRequestClose={handleClose}
    >
      <div className="error-modal-header">
        <h2>{title}</h2>
        <button className="close-button" type="button" onClick={handleClose}>
          X
        </button>
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
        <button type="button" className="ok-button" onClick={handleClose}>
          OK
        </button>
      </div>
    </ReactModal>
  );
}

export default ErrorDialog;
