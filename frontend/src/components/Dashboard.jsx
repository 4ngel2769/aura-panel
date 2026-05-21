import React, { useState, useEffect, useRef } from 'react';
import FileBrowser from './FileBrowser.jsx';

export default function Dashboard({ token, activeDaemon, activeInstance, setActiveInstance }) {
  const [instances, setInstances] = useState([]);
  const [currentTab, setCurrentTab] = useState('terminal'); // 'terminal', 'files', 'settings'
  const [properties, setProperties] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Terminal States
  const [logs, setLogs] = useState([]);
  const [commandInput, setCommandInput] = useState('');
  const [liveStats, setLiveStats] = useState({ systemCpu: 0, systemRamUsed: 0, systemRamTotal: 1, processCpu: 0, processRam: 0 });
  const terminalEndRef = useRef(null);
  const wsRef = useRef(null);
  const activeInstanceRef = useRef(activeInstance);

  useEffect(() => {
    activeInstanceRef.current = activeInstance;
  }, [activeInstance]);

  // Load instances on the active daemon node
  const fetchInstances = () => {
    if (!activeDaemon) return;
    fetch(`/api/proxy/daemons/${activeDaemon.id}/instances`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setInstances(data);
          if (data.length > 0 && !activeInstanceRef.current) {
            setActiveInstance(data[0]);
          }
        } else {
          setInstances([]);
        }
      })
      .catch(err => console.error('Failed to load server list from node:', err));
  };

  useEffect(() => {
    fetchInstances();
    // Poll list state every 5 seconds to sync background states
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [token, activeDaemon]);

  // Load instance properties when tab changes to settings
  useEffect(() => {
    if (activeDaemon && activeInstance && currentTab === 'settings') {
      fetch(`/api/proxy/daemons/${activeDaemon.id}/instances/${activeInstance.id}/properties`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => setProperties(data))
        .catch(err => console.error('Failed to load config properties:', err));
    }
  }, [activeDaemon, activeInstance, currentTab, token]);

  // Handle WebSocket Terminal connections
  useEffect(() => {
    if (!activeDaemon || !activeInstance) return;

    setLogs([]);
    setLiveStats({ systemCpu: 0, systemRamUsed: 0, systemRamTotal: 1, processCpu: 0, processRam: 0 });

    if (wsRef.current) {
      wsRef.current.close();
    }

    // Connect WebSocket through panel proxy
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/proxy/ws-terminal?token=${token}&daemonId=${activeDaemon.id}&instanceId=${activeInstance.id}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'history') {
          setLogs(packet.data);
        } else if (packet.type === 'log') {
          setLogs(prev => [...prev, packet.data].slice(-1000));
        } else if (packet.type === 'stats') {
          setLiveStats(packet.data);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket packet:', e);
      }
    };

    ws.onerror = (e) => {
      setLogs(prev => [...prev, '[Panel Proxy] Terminal socket disconnected.'].slice(-1000));
    };

    ws.onclose = () => {
      // Clean disconnect
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeDaemon, activeInstance, token]);

  // Auto-scroll terminal logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Server Instance Actions
  const handleControlAction = async (action) => {
    if (!activeDaemon || !activeInstance) return;
    try {
      const res = await fetch(`/api/proxy/daemons/${activeDaemon.id}/instances/${activeInstance.id}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Action failed');
      }
      // Reload states immediately
      fetchInstances();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDeleteInstance = async () => {
    if (!activeDaemon || !activeInstance) return;
    
    const deleteFiles = confirm(
      `Are you absolutely sure you want to delete "${activeInstance.name}"?\n\nPress OK to delete the server metadata and completely wipe its server folder/files from the host node filesystem.\nPress Cancel to abort.`
    );
    if (!deleteFiles) return;

    try {
      const res = await fetch(`/api/proxy/daemons/${activeDaemon.id}/instances/${activeInstance.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ deleteFiles: true })
      });
      if (!res.ok) throw new Error('Deletion failed');
      setActiveInstance(null);
      fetchInstances();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleSendCommand = (e) => {
    e.preventDefault();
    if (!commandInput.trim() || !wsRef.current) return;

    wsRef.current.send(commandInput.trim());
    
    // Add command locally for visual instant responsiveness
    setLogs(prev => [...prev, `> ${commandInput.trim()}`]);
    setCommandInput('');
  };

  const handleSaveProperties = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/proxy/daemons/${activeDaemon.id}/instances/${activeInstance.id}/properties`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(properties)
      });
      if (!res.ok) throw new Error('Failed to save settings.');
      alert('Configurations saved successfully! Please restart the Minecraft server for changes to take effect.');
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const updateProperty = (key, value) => {
    setProperties(prev => ({ ...prev, [key]: value }));
  };

  // Color code terminal lines helper
  const renderLogLine = (line, idx) => {
    let color = 'var(--text-primary)';
    if (line.includes('[INFO]') || line.includes('/INFO]')) color = 'var(--text-secondary)';
    else if (line.includes('[WARN]') || line.includes('/WARN]')) color = 'var(--color-warning)';
    else if (line.includes('[ERROR]') || line.includes('/ERROR]')) color = 'var(--color-error)';
    else if (line.startsWith('> ')) color = 'var(--color-green-primary)';
    else if (line.startsWith('[Panel]')) color = 'var(--color-info)';

    return (
      <div key={idx} style={{ color, fontFamily: 'Fira Code, monospace', fontSize: '13px', margin: '3px 0', wordBreak: 'break-all' }}>
        {line}
      </div>
    );
  };

  const activeRamGB = activeInstance ? Math.round(activeInstance.ram / 1024) : 0;
  const sysRamGBTotal = Math.round(liveStats.systemRamTotal / (1024 * 1024 * 1024)) || 1;
  const sysRamGBUsed = Math.round(liveStats.systemRamUsed / (1024 * 1024 * 1024)) || 0;
  const processRamGB = Math.round(liveStats.processRam / (1024 * 1024 * 1024 * 10)) / 10 || 0;

  return (
    <div style={styles.dashboardContainer}>
      {/* Sidebar List */}
      <div style={styles.sidebar}>
        <h3 style={{ fontSize: '16px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '16px' }}>
          Servers List
        </h3>
        <div style={styles.instancesScroll}>
          {instances.length === 0 ? (
            <div style={styles.emptySidebar}>No instances found on this node. Click "+ Create Server" in the top right.</div>
          ) : (
            instances.map(inst => {
              const isActive = activeInstance && activeInstance.id === inst.id;
              
              // Resolve status colored lights
              let statusColor = 'var(--text-disabled)';
              if (inst.status === 'running') statusColor = 'var(--color-green-primary)';
              else if (inst.status === 'starting' || inst.status === 'stopping') statusColor = 'var(--color-warning)';
              else if (inst.status === 'need_eula' || inst.status === 'failed') statusColor = 'var(--color-error)';
              else if (inst.status === 'installing') statusColor = 'var(--color-info)';

              return (
                <div
                  key={inst.id}
                  style={{
                    ...styles.sidebarItem,
                    borderColor: isActive ? 'var(--color-green-primary)' : 'var(--border-color)',
                    backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent'
                  }}
                  onClick={() => {
                    setActiveInstance(inst);
                    setCurrentTab('terminal');
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      ...styles.statusLight,
                      backgroundColor: statusColor,
                      boxShadow: inst.status === 'starting' ? '0 0 8px var(--color-warning)' : 'none',
                    }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: isActive ? 'var(--text-title)' : 'var(--text-primary)' }}>
                        {inst.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {inst.edition.toUpperCase()} • {inst.version}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Server Controller Panel */}
      {activeInstance ? (
        <div style={styles.panelContent}>
          {/* Top Panel Actions Header */}
          <div className="card animate-fade-in" style={styles.instanceHeaderCard}>
            <div>
              <h2 style={{ fontSize: '24px', marginBottom: '4px' }}>{activeInstance.name}</h2>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                <span>Engine: <strong style={{ color: 'var(--text-title)' }}>{activeInstance.edition.toUpperCase()}</strong></span>
                <span>Version: <strong style={{ color: 'var(--text-title)' }}>{activeInstance.version}</strong></span>
                <span>Port: <strong style={{ color: 'var(--text-title)' }}>{activeInstance.port}</strong></span>
                <span>Allocated: <strong style={{ color: 'var(--text-title)' }}>{activeRamGB} GB RAM</strong></span>
                <span>Dockerized: <strong style={{ color: 'var(--text-title)' }}>{activeInstance.dockerEnabled ? 'Yes' : 'No'}</strong></span>
              </div>
            </div>

            {/* Run Controls */}
            <div style={styles.runControls}>
              {activeInstance.status === 'stopped' || activeInstance.status === 'failed' ? (
                <button className="btn btn-primary" onClick={() => handleControlAction('start')}>
                  Start Server
                </button>
              ) : activeInstance.status === 'running' || activeInstance.status === 'starting' ? (
                <>
                  <button className="btn btn-secondary" style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }} onClick={() => handleControlAction('stop')}>
                    Stop
                  </button>
                  <button className="btn btn-danger" onClick={() => handleControlAction('kill')}>
                    Force Kill
                  </button>
                </>
              ) : activeInstance.status === 'stopping' ? (
                <button className="btn btn-secondary" disabled>Stopping...</button>
              ) : activeInstance.status === 'installing' ? (
                <button className="btn btn-secondary" disabled>Setting Up...</button>
              ) : null}
            </div>
          </div>

          {/* EULA Agreement Card */}
          {activeInstance.status === 'need_eula' && (
            <div className="card animate-fade-in" style={styles.eulaCard}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div style={styles.warningGlowIcon}>⚠️</div>
                <div>
                  <h4 style={{ color: 'var(--color-error)', fontSize: '16px', marginBottom: '4px' }}>EULA Agreement Required</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '550px' }}>
                    Mojang requires users to agree to their Minecraft terms. By clicking "Agree & Restart", you represent agreement to their EULA.
                  </p>
                </div>
              </div>
              <button className="btn btn-primary" style={{ backgroundColor: 'var(--color-error)', color: '#fff' }} onClick={() => handleControlAction('eula')}>
                Agree & Restart
              </button>
            </div>
          )}

          {/* Navigation Tabs */}
          <div style={styles.tabBar}>
            <button
              style={{
                ...styles.tabItem,
                borderColor: currentTab === 'terminal' ? 'var(--color-green-primary)' : 'transparent',
                color: currentTab === 'terminal' ? 'var(--text-title)' : 'var(--text-secondary)'
              }}
              onClick={() => setCurrentTab('terminal')}
            >
              Interactive Console
            </button>
            <button
              style={{
                ...styles.tabItem,
                borderColor: currentTab === 'files' ? 'var(--color-green-primary)' : 'transparent',
                color: currentTab === 'files' ? 'var(--text-title)' : 'var(--text-secondary)'
              }}
              onClick={() => setCurrentTab('files')}
            >
              File Explorer
            </button>
            <button
              style={{
                ...styles.tabItem,
                borderColor: currentTab === 'settings' ? 'var(--color-green-primary)' : 'transparent',
                color: currentTab === 'settings' ? 'var(--text-title)' : 'var(--text-secondary)'
              }}
              onClick={() => setCurrentTab('settings')}
            >
              Server Settings (.properties)
            </button>
            <button
              style={{
                ...styles.tabItem,
                borderColor: 'transparent',
                color: 'var(--color-error)',
                marginLeft: 'auto'
              }}
              onClick={handleDeleteInstance}
            >
              Delete Server
            </button>
          </div>

          {/* TAB CONTENT: TERMINAL */}
          {currentTab === 'terminal' && (
            <div style={styles.terminalSplitLayout}>
              {/* Terminal Logs & Console */}
              <div className="card" style={styles.terminalCard}>
                <div style={styles.terminalLogsContainer}>
                  {logs.length === 0 ? (
                    <div style={{ color: 'var(--text-disabled)', fontStyle: 'italic', fontSize: '13px' }}>
                      Terminal pipeline is empty. Launch your Minecraft server to connect live pipelines.
                    </div>
                  ) : (
                    logs.map((line, idx) => renderLogLine(line, idx))
                  )}
                  <div ref={terminalEndRef} />
                </div>
                <form onSubmit={handleSendCommand} style={styles.commandForm}>
                  <span style={styles.promptArrow}>&gt;</span>
                  <input
                    type="text"
                    placeholder="Type server command (e.g. /help, /say, /op)..."
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    disabled={activeInstance.status !== 'running'}
                  />
                  <button type="submit" className="btn btn-secondary" style={{ padding: '8px 16px' }} disabled={activeInstance.status !== 'running'}>
                    Send
                  </button>
                </form>
              </div>

              {/* Hardware Stats Sidebar */}
              <div className="card" style={styles.statsCard}>
                <h4 style={{ marginBottom: '16px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  Resource Watcher
                </h4>

                {/* Instance Stats */}
                <div style={styles.statGroup}>
                  <div style={styles.statMetricRow}>
                    <span>Instance RAM Usage:</span>
                    <strong>{processRamGB} GB / {activeRamGB} GB</strong>
                  </div>
                  <div style={styles.gaugeContainer}>
                    <div style={{
                      ...styles.gaugeFill,
                      width: `${Math.min(100, (processRamGB / activeRamGB) * 100)}%`,
                      backgroundColor: 'var(--color-green-primary)'
                    }} />
                  </div>
                </div>

                {/* Host system stats */}
                <h4 style={{ margin: '32px 0 16px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  Host System Status
                </h4>

                <div style={styles.statGroup}>
                  <div style={styles.statMetricRow}>
                    <span>CPU Average Load:</span>
                    <strong>{liveStats.systemCpu}%</strong>
                  </div>
                  <div style={styles.gaugeContainer}>
                    <div style={{
                      ...styles.gaugeFill,
                      width: `${liveStats.systemCpu}%`,
                      backgroundColor: 'var(--color-warm-primary)'
                    }} />
                  </div>
                </div>

                <div style={styles.statGroup}>
                  <div style={styles.statMetricRow}>
                    <span>Physical RAM Used:</span>
                    <strong>{sysRamGBUsed} GB / {sysRamGBTotal} GB</strong>
                  </div>
                  <div style={styles.gaugeContainer}>
                    <div style={{
                      ...styles.gaugeFill,
                      width: `${Math.round((sysRamGBUsed / sysRamGBTotal) * 100)}%`,
                      backgroundColor: 'var(--color-info)'
                    }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: FILE EXPLORER */}
          {currentTab === 'files' && (
            <FileBrowser
              token={token}
              activeDaemon={activeDaemon}
              instance={activeInstance}
            />
          )}

          {/* TAB CONTENT: PROPERTIES EDITOR */}
          {currentTab === 'settings' && (
            <div className="card animate-fade-in" style={styles.settingsCard}>
              <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Server Configuration Editor</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>
                Quickly edit options inside your `server.properties` file. Changing settings requires a server restart.
              </p>

              {Object.keys(properties).length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Properties file not found or hasn't been generated. Start the server once to automatically build configurations.
                </div>
              ) : (
                <form onSubmit={handleSaveProperties} style={styles.propertiesForm}>
                  <div style={styles.propsGrid}>
                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Game Mode</label>
                      <select
                        value={properties['gamemode'] || 'survival'}
                        onChange={(e) => updateProperty('gamemode', e.target.value)}
                      >
                        <option value="survival">Survival</option>
                        <option value="creative">Creative</option>
                        <option value="adventure">Adventure</option>
                        <option value="spectator">Spectator</option>
                      </select>
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Difficulty</label>
                      <select
                        value={properties['difficulty'] || 'easy'}
                        onChange={(e) => updateProperty('difficulty', e.target.value)}
                      >
                        <option value="peaceful">Peaceful</option>
                        <option value="easy">Easy</option>
                        <option value="normal">Normal</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Server Port</label>
                      <input
                        type="number"
                        value={properties['server-port'] || '25565'}
                        onChange={(e) => updateProperty('server-port', e.target.value)}
                      />
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Max Players</label>
                      <input
                        type="number"
                        value={properties['max-players'] || '20'}
                        onChange={(e) => updateProperty('max-players', e.target.value)}
                      />
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Enable PVP</label>
                      <select
                        value={properties['pvp'] || 'true'}
                        onChange={(e) => updateProperty('pvp', e.target.value)}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Enable Whitelist</label>
                      <select
                        value={properties['white-list'] || 'false'}
                        onChange={(e) => updateProperty('white-list', e.target.value)}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Online Mode</label>
                      <select
                        value={properties['online-mode'] || 'true'}
                        onChange={(e) => updateProperty('online-mode', e.target.value)}
                      >
                        <option value="true">Enabled (Official Accounts Only)</option>
                        <option value="false">Disabled (Offline Mode)</option>
                      </select>
                    </div>

                    <div style={styles.propsRow}>
                      <label style={styles.propLabel}>Allow Flight</label>
                      <select
                        value={properties['allow-flight'] || 'false'}
                        onChange={(e) => updateProperty('allow-flight', e.target.value)}
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </div>
                  </div>

                  <div style={styles.propsRowFull}>
                    <label style={styles.propLabel}>Server MOTD (Message of the Day)</label>
                    <input
                      type="text"
                      value={properties['motd'] || 'A Minecraft Server'}
                      onChange={(e) => updateProperty('motd', e.target.value)}
                    />
                  </div>

                  <div style={styles.propertiesFormFooter}>
                    <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                      {savingSettings ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={styles.noServerPanel}>
          <div style={styles.emptyStateContainer}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            <h3 style={{ margin: '16px 0 6px' }}>No Active Minecraft Server</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '360px', textAlign: 'center', marginBottom: '24px' }}>
              Welcome! You haven't added any server instances yet on this node. Click "+ Create Server" to build one now.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  dashboardContainer: {
    display: 'grid',
    gridTemplateColumns: '260px 1fr',
    gap: '32px',
    alignItems: 'start',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
  },
  instancesScroll: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: 'calc(100vh - 160px)',
    overflowY: 'auto',
  },
  emptySidebar: {
    fontSize: '12px',
    color: 'var(--text-disabled)',
    textAlign: 'center',
    padding: '20px 10px',
    border: '1px dashed var(--border-color)',
    borderRadius: 'var(--radius-md)',
  },
  sidebarItem: {
    padding: '14px 18px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  statusLight: {
    width: '10px',
    height: '10px',
    borderRadius: 'var(--radius-full)',
  },
  panelContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  instanceHeaderCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 32px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  runControls: {
    display: 'flex',
    gap: '12px',
  },
  eulaCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: '1px solid var(--color-error)',
    backgroundColor: 'var(--color-error-glow)',
    padding: '20px 32px',
  },
  warningGlowIcon: {
    fontSize: '28px',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--border-color)',
    gap: '24px',
    paddingBottom: '2px',
    flexWrap: 'wrap'
  },
  tabItem: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '8px 4px 12px',
    fontFamily: 'Outfit, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    outline: 'none',
  },
  terminalSplitLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 280px',
    gap: '24px',
    alignItems: 'start',
  },
  terminalCard: {
    padding: '0',
    backgroundColor: '#07080a',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  },
  terminalLogsContainer: {
    height: '420px',
    overflowY: 'auto',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
  },
  commandForm: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 18px',
    backgroundColor: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border-color)',
    gap: '12px',
  },
  promptArrow: {
    fontFamily: 'Fira Code, monospace',
    color: 'var(--color-green-primary)',
    fontWeight: 'bold',
    fontSize: '15px',
  },
  statsCard: {
    padding: '24px',
  },
  statGroup: {
    marginBottom: '20px',
  },
  statMetricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    marginBottom: '8px',
    color: 'var(--text-secondary)',
  },
  gaugeContainer: {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--border-color)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    transition: 'width 0.5s ease',
  },
  settingsCard: {
    padding: '32px',
  },
  propertiesForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  propsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
  },
  propsRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  propsRowFull: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  propLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  propertiesFormFooter: {
    borderTop: '1px solid var(--border-color)',
    paddingTop: '24px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  noServerPanel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px dashed var(--border-color)',
    borderRadius: 'var(--radius-lg)',
  },
  emptyStateContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px',
  }
};
