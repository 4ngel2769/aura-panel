import React, { useState, useEffect } from 'react';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import SetupWizard from './components/SetupWizard.jsx';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('aura_token') || '');
  const [username, setUsername] = useState(localStorage.getItem('aura_username') || '');
  const [isInitialized, setIsInitialized] = useState(true);
  const [activeInstance, setActiveInstance] = useState(null);
  const [showWizard, setShowWizard] = useState(false);

  // Check backend auth status on boot
  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setIsInitialized(data.initialized);
      })
      .catch(err => console.error('Failed to connect to backend API:', err));
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
    setActiveInstance(null);
    setShowWizard(false);
  };

  // If not logged in or panel not initialized, show authentication panel
  if (!token || !isInitialized) {
    return (
      <Login
        isInitialized={isInitialized}
        onLoginSuccess={handleLoginSuccess}
        onInitComplete={() => setIsInitialized(true)}
      />
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
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Logged in as <strong style={{ color: 'var(--text-title)' }}>{username}</strong>
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
            onComplete={(instance) => {
              setShowWizard(false);
              setActiveInstance(instance);
            }}
            onCancel={() => setShowWizard(false)}
          />
        ) : (
          <Dashboard
            token={token}
            activeInstance={activeInstance}
            setActiveInstance={setActiveInstance}
          />
        )}
      </main>
    </div>
  );
}
