import React, { useState, useEffect } from 'react';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import DaemonWizard from './components/DaemonWizard.jsx';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('aura_token') || '');
  const [username, setUsername] = useState(localStorage.getItem('aura_username') || '');
  const [isInitialized, setIsInitialized] = useState(true);
  
  // Distributed nodes states
  const [daemons, setDaemons] = useState([]);
  const [activeDaemon, setActiveDaemon] = useState(null);
  
  const [activeInstance, setActiveInstance] = useState(null);
  const [showWizard, setShowWizard] = useState(false);

  // Check backend user status on boot
  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setIsInitialized(data.initialized);
      })
      .catch(err => console.error('Failed to connect to panel backend:', err));
  }, [token]);

  // Load daemon nodes list
  const fetchDaemons = () => {
    if (!token) return;
    fetch('/api/daemons', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setDaemons(data);
        if (data.length > 0) {
          // Keep active daemon synced, default to first node
          setActiveDaemon(prev => prev ? data.find(d => d.id === prev.id) || data[0] : data[0]);
        } else {
          setActiveDaemon(null);
        }
      })
      .catch(err => console.error('Failed loading daemon list:', err));
  };

  useEffect(() => {
    fetchDaemons();
  }, [token]);

  const handleLoginSuccess = (newToken, newUsername) => {
    localStorage.setItem('aura_token', newToken);
    localStorage.setItem('aura_username', newUsername);
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleLogout = () => {
    localStorage.removeItem('aura_token');
    localStorage.removeItem('aura_username');
    setToken('');
    setUsername('');
    setActiveDaemon(null);
    setDaemons([]);
    setActiveInstance(null);
    setShowWizard(false);
  };

  const handleDaemonRegistered = (newDaemon) => {
    fetchDaemons();
  };

  if (!token || !isInitialized) {
    return (
      <Login
        isInitialized={isInitialized}
        onLoginSuccess={handleLoginSuccess}
        onInitComplete={() => setIsInitialized(true)}
      />
    );
  }

  // If logged in but no daemons exist, guide user to connect their first node!
  if (daemons.length === 0) {
    return (
      <div className="app-container">
        <header className="navbar">
          <div className="navbar-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-green-primary)'}}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span>AuraPanel</span>
          </div>
          <button className="btn btn-secondary" style={{ padding: '8px 16px', borderColor: 'var(--color-error)', color: 'var(--color-error)' }} onClick={handleLogout}>
            Logout
          </button>
        </header>
        <main className="main-content">
          <DaemonWizard token={token} onComplete={handleDaemonRegistered} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="navbar">
        <div className="navbar-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-green-primary)'}}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>AuraPanel</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Node Selector Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Node:</span>
            <select
              style={{ padding: '6px 12px', width: 'auto', fontSize: '13px' }}
              value={activeDaemon ? activeDaemon.id : ''}
              onChange={(e) => {
                const node = daemons.find(d => d.id === e.target.value);
                setActiveDaemon(node);
                setActiveInstance(null); // Clear instance when node changes
              }}
            >
              {daemons.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
              ))}
            </select>
          </div>

          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            User: <strong style={{ color: 'var(--text-title)' }}>{username}</strong>
          </span>

          {showWizard ? (
            <button className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => setShowWizard(false)}>
              Back to Dashboard
            </button>
          ) : (
            <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={() => setShowWizard(true)}>
              + Create Server
            </button>
          )}

          <button className="btn btn-secondary" style={{ padding: '8px 16px', borderColor: 'var(--color-error)', color: 'var(--color-error)' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="main-content">
        {showWizard ? (
          <SetupWizard
            token={token}
            activeDaemon={activeDaemon}
            onComplete={(instance) => {
              setShowWizard(false);
              setActiveInstance(instance);
            }}
            onCancel={() => setShowWizard(false)}
          />
        ) : (
          <Dashboard
            token={token}
            activeDaemon={activeDaemon}
            activeInstance={activeInstance}
            setActiveInstance={setActiveInstance}
          />
        )}
      </main>
    </div>
  );
}
