import React, { useState, useEffect } from 'react';

const ENGINES = [
  { id: 'paper', name: 'PaperMC', desc: 'Highly optimized Java server software. The standard choice for multiplayer servers.', category: 'java' },
  { id: 'purpur', name: 'PurpurMC', desc: 'Customizable Fork of Paper. Excellent performance with lots of advanced configuration settings.', category: 'java' },
  { id: 'fabric', name: 'Fabric', desc: 'Modern, modular, and extremely fast modding engine. Standard for modpacks and custom servers.', category: 'java' },
  { id: 'vanilla', name: 'Vanilla Java', desc: 'Official unmodified Minecraft server jar. Great for basic private snapshots/release playing.', category: 'java' },
  { id: 'bedrock', name: 'Bedrock Dedicated', desc: 'Official server engine for Bedrock Edition. Best for Mobile, Console, and Windows 10 crossplay.', category: 'bedrock' },
  { id: 'spigot', name: 'Spigot', desc: 'Traditional plugin software. High plugin compatibility, though less optimized than Paper.', category: 'java' },
  { id: 'forge', name: 'Forge', desc: 'Legacy modding engine. Massive mod ecosystem for older versions of Minecraft.', category: 'java' },
  { id: 'neoforge', name: 'NeoForge', desc: 'Modernized fork of Forge. The new standard for modern heavy modpacks.', category: 'java' },
  { id: 'glowstone', name: 'Glowstone', desc: 'Lightweight, independent Java server written from scratch. Doesn\'t require Mojang binaries.', category: 'java' }
];

export default function SetupWizard({ token, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [selectedEngine, setSelectedEngine] = useState(ENGINES[0]);
  const [versions, setVersions] = useState([]);
  const [filteredVersions, setFilteredVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Hardware allocations
  const [systemRam, setSystemRam] = useState(16384); // fallback 16GB total
  const [ramValue, setRamValue] = useState(4096); // default 4GB
  const [ramUnit, setRamUnit] = useState('GB'); // 'GB' or 'MB'

  // Settings
  const [instanceName, setInstanceName] = useState('');
  const [dockerEnabled, setDockerEnabled] = useState(false);
  const [optimalFlags, setOptimalFlags] = useState([]);

  // Installation States
  const [isInstalling, setIsInstalling] = useState(false);
  const [createdInstanceId, setCreatedInstanceId] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(null);

  // Fetch system RAM to set appropriate limits
  useEffect(() => {
    fetch('/api/system/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.totalMemory) {
          // Convert from bytes to MB
          setSystemRam(Math.round(data.totalMemory / (1024 * 1024)));
        }
      })
      .catch(err => console.error('Failed to load system RAM:', err));
  }, [token]);

  // Fetch versions when engine changes
  useEffect(() => {
    if (step === 2) {
      setVersions([]);
      setSelectedVersion('');
      fetch(`/api/versions/${selectedEngine.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          setVersions(data);
          setFilteredVersions(data);
          if (data.length > 0) {
            setSelectedVersion(data[0].id);
          }
        })
        .catch(err => console.error('Failed to fetch versions:', err));
    }
  }, [selectedEngine, step, token]);

  // Handle version filter search
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredVersions(versions);
    } else {
      setFilteredVersions(
        versions.filter(v => v.id.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
  }, [searchQuery, versions]);

  // Keep instanceName synced
  useEffect(() => {
    if (selectedEngine && selectedVersion) {
      setInstanceName(`mc-${selectedEngine.id}-${selectedVersion}`);
    }
  }, [selectedEngine, selectedVersion]);

  // Sync optimal flags preview
  useEffect(() => {
    // Generate JVM flag mock display
    const ramMB = ramUnit === 'GB' ? ramValue * 1024 : ramValue;
    const sizeString = ramUnit === 'GB' ? `${ramValue}G` : `${ramValue}M`;
    const flags = [`-Xms${sizeString}`, `-Xmx${sizeString}`, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled'];
    if (['paper', 'purpur', 'spigot'].includes(selectedEngine.id) && ramMB >= 2048) {
      flags.push('-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC');
    }
    setOptimalFlags(flags);
  }, [selectedEngine, ramValue, ramUnit]);

  // Long-polling download tracker
  useEffect(() => {
    let timer;
    if (isInstalling && createdInstanceId) {
      const checkProgress = () => {
        fetch(`/api/instances/${createdInstanceId}/download-status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            setDownloadProgress(data);
            if (data.status === 'completed') {
              setIsInstalling(false);
              // Complete Setup
              setTimeout(() => {
                onComplete({ id: createdInstanceId });
              }, 1500);
            } else if (data.status === 'failed') {
              setIsInstalling(false);
              alert(`Installation failed: ${data.error || 'Server error'}`);
            } else {
              timer = setTimeout(checkProgress, 800);
            }
          })
          .catch(err => {
            console.error('Progress poll failed:', err);
            timer = setTimeout(checkProgress, 2000);
          });
      };
      
      checkProgress();
    }

    return () => clearTimeout(timer);
  }, [isInstalling, createdInstanceId, token]);

  const handleBuild = async () => {
    setIsInstalling(true);
    const ramMB = ramUnit === 'GB' ? ramValue * 1024 : ramValue;

    try {
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: instanceName,
          edition: selectedEngine.id,
          version: selectedVersion,
          ram: ramMB,
          dockerEnabled
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger installation.');

      setCreatedInstanceId(data.instance.id);
    } catch (e) {
      alert(e.message);
      setIsInstalling(false);
    }
  };

  const handleRamSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (ramUnit === 'GB') {
      setRamValue(Math.round(val / 1024));
    } else {
      setRamValue(val);
    }
  };

  const setRamInGB = (gb) => {
    setRamUnit('GB');
    setRamValue(gb);
  };

  const maxRamMB = Math.round(systemRam * 0.85); // restrict max ram allocation safety to 85% of physical limits

  // Render progress interface
  if (isInstalling) {
    return (
      <div className="card animate-fade-in" style={styles.loadingCard}>
        <div style={styles.spinnerContainer}>
          <div className="pulse-glow" style={styles.glowingCore} />
          <svg style={styles.svgSpinner} viewBox="0 0 50 50">
            <circle style={styles.svgSpinnerCircle} cx="25" cy="25" r="20" fill="none" strokeWidth="4"></circle>
          </svg>
        </div>
        <h2 style={{ marginBottom: '12px', fontSize: '24px' }}>Building Your Minecraft Server</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center', maxWidth: '400px' }}>
          We are fetching core source binaries, building directories, and constructing your configurations on the host filesystem.
        </p>

        {downloadProgress && (
          <div style={styles.progressContainer}>
            <div style={styles.progressBarBg}>
              <div style={{ ...styles.progressBarFill, width: `${downloadProgress.progress || 0}%` }} />
            </div>
            <div style={styles.progressInfo}>
              <span>Status: <strong style={{ color: 'var(--text-title)' }}>{downloadProgress.status}</strong></span>
              <span>{downloadProgress.progress || 0}%</span>
            </div>
            {downloadProgress.speed && downloadProgress.status === 'downloading' && (
              <span style={styles.downloadStats}>
                Downloaded: {Math.round(downloadProgress.bytesDownloaded / (1024 * 1024))}MB / {Math.round(downloadProgress.bytesTotal / (1024 * 1024))}MB ({downloadProgress.speed})
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card animate-fade-in" style={styles.wizardCard}>
      {/* Wizard Step Markers */}
      <div style={styles.stepsHeader}>
        {['Engine Selection', 'Version Scroll', 'Hardware Allocation', 'Configure & Finish'].map((label, idx) => (
          <div key={label} style={{ ...styles.stepMarker, opacity: step === idx + 1 ? 1 : 0.4 }}>
            <div style={{
              ...styles.stepNumber,
              backgroundColor: step >= idx + 1 ? 'var(--color-green-primary)' : 'var(--bg-tertiary)',
              color: step >= idx + 1 ? 'var(--bg-primary)' : 'var(--text-secondary)'
            }}>{idx + 1}</div>
            <span style={styles.stepLabel}>{label}</span>
          </div>
        ))}
      </div>

      {/* STEP 1: Engine choice */}
      {step === 1 && (
        <div>
          <h3 style={styles.stepTitle}>Select Minecraft Engine</h3>
          <p style={styles.stepDesc}>Pick the flavor that fits your gameplay. Performance engines are highly recommended for optimal resource limits.</p>
          <div style={styles.enginesGrid}>
            {ENGINES.map(engine => (
              <div
                key={engine.id}
                className="card"
                style={{
                  ...styles.engineCard,
                  borderColor: selectedEngine.id === engine.id ? 'var(--color-green-primary)' : 'var(--border-color)',
                  backgroundColor: selectedEngine.id === engine.id ? 'rgba(16, 185, 129, 0.03)' : 'var(--bg-secondary)',
                }}
                onClick={() => setSelectedEngine(engine)}
              >
                <div style={styles.engineHeader}>
                  <h4 style={{ fontSize: '18px' }}>{engine.name}</h4>
                  <span style={{
                    ...styles.engineBadge,
                    backgroundColor: engine.category === 'java' ? 'var(--color-warm-glow)' : 'rgba(59, 130, 246, 0.15)',
                    color: engine.category === 'java' ? 'var(--color-warm-primary)' : 'var(--color-info)'
                  }}>
                    {engine.category.toUpperCase()}
                  </span>
                </div>
                <p style={styles.engineText}>{engine.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2: Version scrolling */}
      {step === 2 && (
        <div>
          <h3 style={styles.stepTitle}>Select Edition Version</h3>
          <p style={styles.stepDesc}>Scroll or search the official builds dynamically sourced from source channels.</p>
          
          <div style={styles.searchBoxContainer}>
            <input
              type="text"
              placeholder="Search versions (e.g. 1.20, 1.21.1)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={styles.versionsContainer}>
            {filteredVersions.length === 0 ? (
              <div style={styles.emptyList}>
                {versions.length === 0 ? 'Fetching available index...' : 'No matching versions found.'}
              </div>
            ) : (
              filteredVersions.map(v => (
                <div
                  key={v.id}
                  style={{
                    ...styles.versionItem,
                    borderColor: selectedVersion === v.id ? 'var(--color-green-primary)' : 'var(--border-color)',
                    backgroundColor: selectedVersion === v.id ? 'var(--bg-accent)' : 'transparent',
                  }}
                  onClick={() => setSelectedVersion(v.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      ...styles.bullet,
                      backgroundColor: selectedVersion === v.id ? 'var(--color-green-primary)' : 'var(--border-focus)'
                    }} />
                    <span style={{ fontWeight: 600 }}>{v.id}</span>
                  </div>
                  <span style={styles.versionTypeBadge}>
                    {v.type || 'stable'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* STEP 3: Memory limits */}
      {step === 3 && (
        <div>
          <h3 style={styles.stepTitle}>Allocate Hardware Resources</h3>
          <p style={styles.stepDesc}>Dedicate system RAM for your Minecraft instance. Custom sliders ensure allocations stay within safe host guidelines.</p>
          
          <div style={styles.ramGrid}>
            <div className="card" style={styles.ramPanelLeft}>
              <div style={styles.ramValues}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Dedicated RAM</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <input
                    type="number"
                    style={styles.ramInput}
                    value={ramValue}
                    onChange={(e) => setRamValue(Math.max(256, parseInt(e.target.value, 10) || 0))}
                  />
                  <select
                    style={styles.ramUnitSelect}
                    value={ramUnit}
                    onChange={(e) => {
                      const newUnit = e.target.value;
                      setRamUnit(newUnit);
                      if (newUnit === 'GB') {
                        setRamValue(Math.round(ramValue / 1024) || 1);
                      } else {
                        setRamValue(ramValue * 1024);
                      }
                    }}
                  >
                    <option value="GB">GB</option>
                    <option value="MB">MB</option>
                  </select>
                </div>
              </div>

              {/* Slider Component */}
              <div style={{ margin: '24px 0' }}>
                <input
                  type="range"
                  min="512"
                  max={maxRamMB}
                  step="256"
                  value={ramUnit === 'GB' ? ramValue * 1024 : ramValue}
                  onChange={handleRamSliderChange}
                />
                <div style={styles.sliderLabels}>
                  <span>512 MB</span>
                  <span>Max Safe ({Math.round(maxRamMB/1024)} GB)</span>
                </div>
              </div>

              {/* Preset Buttons */}
              <div style={styles.presetsGrid}>
                {[2, 4, 8, 12, 16].map(g => (
                  <button
                    key={g}
                    className="btn btn-secondary"
                    style={{
                      padding: '8px 12px',
                      backgroundColor: ramUnit === 'GB' && ramValue === g ? 'var(--bg-accent)' : 'transparent',
                      borderColor: ramUnit === 'GB' && ramValue === g ? 'var(--color-green-primary)' : 'var(--border-color)',
                      color: ramUnit === 'GB' && ramValue === g ? 'var(--color-green-primary)' : 'var(--text-primary)'
                    }}
                    disabled={g * 1024 > maxRamMB}
                    onClick={() => setRamInGB(g)}
                  >
                    {g} GB
                  </button>
                ))}
              </div>
            </div>

            <div className="card" style={styles.ramPanelRight}>
              <h4 style={{ marginBottom: '12px' }}>System Resource Limits</h4>
              <div style={styles.ramProgressBg}>
                <div style={{
                  ...styles.ramProgressFill,
                  width: `${Math.min(100, ((ramUnit === 'GB' ? ramValue * 1024 : ramValue) / systemRam) * 100)}%`,
                  backgroundColor: (ramUnit === 'GB' ? ramValue * 1024 : ramValue) > maxRamMB ? 'var(--color-error)' : 'var(--color-green-primary)'
                }} />
              </div>
              <div style={styles.ramMetricRow}>
                <span>Allocated to Instance:</span>
                <strong>{ramUnit === 'GB' ? `${ramValue} GB` : `${ramValue} MB`}</strong>
              </div>
              <div style={styles.ramMetricRow}>
                <span>Total System Memory:</span>
                <strong>{Math.round(systemRam / 1024)} GB</strong>
              </div>
              <div style={styles.ramWarning}>
                <strong>Tip:</strong> Leaving at least 2 GB of RAM unallocated ensures your host operating system and background agents run smoothly.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Execution choices & finish */}
      {step === 4 && (
        <div style={styles.finishContainer}>
          <h3 style={styles.stepTitle}>Final Configurations</h3>
          <p style={styles.stepDesc}>Review final configurations and choose where the server runs. Files persist in the host system either way.</p>

          <div style={styles.formItem}>
            <label style={styles.label}>Server Display Name</label>
            <input
              type="text"
              placeholder="e.g. My Survival Server"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
            />
          </div>

          <div className="card" style={styles.dockerControlCard}>
            <div style={styles.dockerToggleRow}>
              <div>
                <h4 style={{ marginBottom: '4px' }}>Containerization (Docker Mode)</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '450px' }}>
                  Spawns server isolated in a Docker container using a secure eclipse-temurin Java JRE. Prevents Java version clashes on the host.
                </p>
              </div>
              <label style={styles.switch}>
                <input
                  type="checkbox"
                  checked={dockerEnabled}
                  onChange={(e) => setDockerEnabled(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>

          {selectedEngine.category === 'java' && (
            <div className="card" style={styles.flagsCard}>
              <h4 style={{ marginBottom: '8px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Optimal Java JVM Start Flags Preview
              </h4>
              <div style={styles.flagsContainer}>
                {optimalFlags.join(' ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wizard Footer Controls */}
      <div style={styles.footer}>
        {step > 1 ? (
          <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <button className="btn btn-secondary" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }} onClick={onCancel}>
            Cancel Setup
          </button>
        )}

        {step < 4 ? (
          <button
            className="btn btn-primary"
            disabled={step === 2 && !selectedVersion}
            onClick={() => setStep(step + 1)}
          >
            Next Step
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleBuild}>
            Build Server Core
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  wizardCard: {
    padding: '40px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '18px',
    maxWidth: '900px',
    margin: '0 auto',
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
  },
  loadingCard: {
    padding: '60px 40px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '18px',
    maxWidth: '550px',
    margin: '60px auto',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
  },
  spinnerContainer: {
    position: 'relative',
    width: '80px',
    height: '80px',
    marginBottom: '28px',
  },
  glowingCore: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    width: '40px',
    height: '40px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-green-primary)',
    filter: 'blur(12px)',
  },
  svgSpinner: {
    width: '100%',
    height: '100%',
    animation: 'spin 1.2s linear infinite',
  },
  svgSpinnerCircle: {
    stroke: 'var(--color-green-primary)',
    strokeLinecap: 'round',
    animation: 'dash 1.5s ease-in-out infinite',
  },
  progressContainer: {
    width: '100%',
    marginTop: '10px',
  },
  progressBarBg: {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--border-color)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    marginBottom: '12px',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: 'var(--color-green-primary)',
    transition: 'width 0.3s ease',
  },
  progressInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    marginBottom: '8px',
  },
  downloadStats: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    display: 'block',
  },
  stepsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '24px',
    marginBottom: '32px',
  },
  stepMarker: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    transition: 'opacity var(--transition-fast)',
  },
  stepNumber: {
    width: '32px',
    height: '32px',
    borderRadius: 'var(--radius-full)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 'bold',
  },
  stepLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'center',
  },
  stepTitle: {
    fontSize: '22px',
    marginBottom: '4px',
  },
  stepDesc: {
    color: 'var(--text-secondary)',
    fontSize: '14px',
    marginBottom: '28px',
  },
  enginesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '16px',
    maxHeight: '360px',
    overflowY: 'auto',
    paddingRight: '6px',
    marginBottom: '10px',
  },
  engineCard: {
    cursor: 'pointer',
    padding: '20px',
    transition: 'all var(--transition-fast)',
    boxShadow: 'none',
  },
  engineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  engineBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    padding: '4px 8px',
    borderRadius: '6px',
  },
  engineText: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
  },
  searchBoxContainer: {
    marginBottom: '16px',
  },
  versionsContainer: {
    maxHeight: '260px',
    overflowY: 'auto',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
  },
  versionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  bullet: {
    width: '8px',
    height: '8px',
    borderRadius: 'var(--radius-full)',
  },
  versionTypeBadge: {
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
  },
  emptyList: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    fontSize: '14px',
  },
  ramGrid: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1fr',
    gap: '24px',
  },
  ramPanelLeft: {
    padding: '28px',
    boxShadow: 'none',
  },
  ramPanelRight: {
    padding: '28px',
    backgroundColor: 'var(--bg-tertiary)',
    boxShadow: 'none',
  },
  ramValues: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ramInput: {
    width: '90px',
    fontSize: '16px',
    fontWeight: 'bold',
    padding: '8px 12px',
    textAlign: 'center',
  },
  ramUnitSelect: {
    width: '70px',
    padding: '8px 10px',
    fontSize: '14px',
  },
  sliderLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    marginTop: '8px',
  },
  presetsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '8px',
  },
  ramProgressBg: {
    width: '100%',
    height: '8px',
    backgroundColor: 'var(--border-color)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    margin: '16px 0 24px',
  },
  ramProgressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  ramMetricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    marginBottom: '12px',
    borderBottom: '1px dashed var(--border-color)',
    paddingBottom: '8px',
  },
  ramWarning: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-accent)',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    marginTop: '20px',
    borderLeft: '3px solid var(--color-green-primary)',
  },
  finishContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  formItem: {
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
  dockerControlCard: {
    padding: '24px',
    boxShadow: 'none',
  },
  dockerToggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flagsCard: {
    padding: '20px',
    backgroundColor: 'var(--bg-tertiary)',
    boxShadow: 'none',
  },
  flagsContainer: {
    fontFamily: 'Fira Code, monospace',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    backgroundColor: 'var(--bg-primary)',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    lineHeight: '1.6',
    border: '1px solid var(--border-color)',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '40px',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '24px',
  },

  /* Custom Switch Slider */
  switch: {
    position: 'relative',
    display: 'inline-block',
    width: '46px',
    height: '24px',
  },
};
