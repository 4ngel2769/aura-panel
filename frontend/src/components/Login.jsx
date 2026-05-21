import React, { useState } from 'react';

export default function Login({ isInitialized, onLoginSuccess, onInitComplete }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isInitialized ? '/api/auth/login' : '/api/auth/register';
    const bodyPayload = isInitialized 
      ? { username, password } 
      : { username, password };

    if (!isInitialized && password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (isInitialized) {
        onLoginSuccess(data.token, data.username);
      } else {
        // Registration success, toggle initialized state to prompt user login
        onInitComplete();
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setError('Success! Please log in with your credentials.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div className="card animate-fade-in" style={styles.card}>
        <div style={styles.logoContainer}>
          <div style={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-green-primary)'}}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2 style={styles.title}>AuraPanel</h2>
          <p style={styles.subtitle}>
            {isInitialized 
              ? 'Secure Minecraft Instance Administrator' 
              : 'Setup Your Minecraft Admin Dashboard'}
          </p>
        </div>

        {error && (
          <div style={{
            ...styles.alert,
            backgroundColor: error.startsWith('Success') ? 'var(--color-green-glow)' : 'var(--color-error-glow)',
            borderColor: error.startsWith('Success') ? 'var(--color-green-primary)' : 'var(--color-error)',
            color: error.startsWith('Success') ? 'var(--color-green-primary)' : 'var(--color-error)',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Admin Username</label>
            <input
              type="text"
              placeholder="e.g. administrator"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Master Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          {!isInitialized && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Confirm Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          )}

          <button 
            type="submit" 
            className="btn btn-primary" 
            style={styles.submitBtn}
            disabled={loading}
          >
            {loading ? 'Processing...' : isInitialized ? 'Access Dashboard' : 'Initialize Setup'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: 'var(--bg-primary)',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '460px',
    padding: '40px',
    backgroundColor: 'var(--bg-secondary)',
    boxShadow: '0 10px 40px -10px rgba(0,0,0,0.5)',
    border: '1px solid var(--border-color)',
    borderRadius: '18px',
  },
  logoContainer: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  logoIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '64px',
    height: '64px',
    borderRadius: '16px',
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    marginBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    marginBottom: '6px',
    letterSpacing: '-0.03em',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  submitBtn: {
    marginTop: '10px',
    width: '100%',
  },
  alert: {
    padding: '12px 16px',
    borderRadius: '12px',
    border: '1px solid',
    fontSize: '13px',
    marginBottom: '20px',
    textAlign: 'center',
    animation: 'fadeIn 0.2s ease-out forwards',
  }
};
