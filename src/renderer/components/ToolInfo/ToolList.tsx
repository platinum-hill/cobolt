import React, { useEffect, Dispatch, SetStateAction, useState } from 'react';
import ReactModal from 'react-modal';
import log from 'electron-log/renderer';
import { ToolInfo } from '../../types';
import './ToolList.css';

type props = {
  isOpen: boolean;
  setisOpen: Dispatch<SetStateAction<boolean>>;
};

function ToolList({ isOpen, setisOpen }: props) {
  const [toolsByServer, setToolsByServer] = React.useState<
    Record<string, ToolInfo[]>
  >({});
  const [expandedServers, setExpandedServers] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    const fetchToolInfo = async () => {
      const toolInfoList = await window.api.listTools();

      // Group tools by serverName
      const groupedTools: Record<string, ToolInfo[]> = {};
      const initialExpandedState: Record<string, boolean> = {};

      toolInfoList.forEach((tool: ToolInfo) => {
        if (!groupedTools[tool.serverName]) {
          groupedTools[tool.serverName] = [];
          initialExpandedState[tool.serverName] = false; // Default to collapsed
        }
        groupedTools[tool.serverName].push(tool);
      });

      setToolsByServer(groupedTools);
      setExpandedServers(initialExpandedState);
    };

    if (isOpen) {
      fetchToolInfo();
    }
  }, [isOpen]);

  const toggleServerExpand = (serverName: string) => {
    setExpandedServers((prev) => ({
      ...prev,
      [serverName]: !prev[serverName],
    }));
  };

  const handleOpenMcpServersFile = async () => {
    try {
      await window.api.openMcpServersFile();
    } catch (error) {
      log.error('Failed to open MCP servers file:', error);
    }
  };

  return (
    isOpen && (
      <ReactModal
        isOpen={isOpen}
        className="Modal"
        overlayClassName="Overlay"
        closeTimeoutMS={300}
        ariaHideApp={false}
        onRequestClose={() => setisOpen(false)}
      >
        <div className="modal-header">
          <h1>Integrations</h1>
          <button
            className="close-button"
            type="button"
            onClick={() => setisOpen(false)}
          >
            X
          </button>
        </div>
        <div className="ToolContainer">
          {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
            <div key={serverName} className="ServerGroup">
              <button
                type="button"
                className="ServerHeader"
                onClick={() => toggleServerExpand(serverName)}
              >
                <span className="ExpandToggle">
                  {expandedServers[serverName] ? '▼' : '►'}
                </span>
                <h2 className="ServerName">{serverName}</h2>
              </button>
              {expandedServers[serverName] && (
                <div className="ServerTools" id={`server-tools-${serverName}`}>
                  {serverTools.map((tool) => (
                    <div key={tool.name} className="ToolInfo">
                      <h4>{tool.name}</h4>
                      <p>{tool.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="config-button-sticky"
          onClick={handleOpenMcpServersFile}
          title="Open MCP Servers Config"
        >
          +
        </button>
      </ReactModal>
    )
  );
}

export default ToolList;
