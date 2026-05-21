import React, { useState, useEffect, useRef } from 'react';

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

export default function SetupWizard({ token, activeDaemon, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [creationMode, setCreationMode] = useState('download'); // 'download', 'link', 'upload'
  const [selectedEngine, setSelectedEngine] = useState(ENGINES[0]);
  const [versions, setVersions] = useState([]);
  const [filteredVersions, setFilteredVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Host path details
  const [customPath, setCustomPath] = useState('');
  const [instanceName, setInstanceName] = useState('');
  
  // ZIP upload states
  const [zipUploadProgress, setZipUploadProgress] = useState(null);
  const [uploadedZipPath, setUploadedZipPath] = useState('');
  const [uploadedZipName, setUploadedZipName] = useState('');
  const zipInputRef = useRef(null);

  // Hardware allocations
  const [systemRam, setSystemRam] = useState(16384); // fallback 16GB total
  const [ramValue, setRamValue] = useState(4096); // default 4GB
  const [ramUnit, setRamUnit] = useState('GB'); // 'GB' or 'MB'

  // Settings
  const [dockerEnabled, setDockerEnabled] = useState(false);
  const [optimalFlags, setOptimalFlags] = useState([]);

  // Installation States
  const [isInstalling, setIsInstalling] = useState(false);
  const [createdInstanceId, setCreatedInstanceId] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(null);

  // Sync Default Paths & Names
  useEffect(() => {
    const defaultName = `mc-${selectedEngine?.id || 'server'}-${selectedVersion || 'latest'}`;
    setInstanceName(defaultName);
    setCustomPath(`/home/aura/servers/${defaultName}`);
  }, [selectedEngine, selectedVersion, creationMode]);

  // Fetch active daemon stats to verify RAM limits
  useEffect(() => {
    if (!activeDaemon) return;
    fetch(`/api/proxy/daemons/${activeDaemon.id}/system/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.totalMemory) {
          setSystemRam(Math.round(data.totalMemory / (1024 * 1024)));
        }
      })
      .catch(err => console.error('Failed to load system RAM:', err));
  }, [activeDaemon, token]);

  // Fetch engine versions dynamically
  useEffect(() => {
    if (step === 3 && creationMode === 'download' && activeDaemon) {
      setVersions([]);
      setSelectedVersion('');
      fetch(`/api/proxy/daemons/${activeDaemon.id}/versions/${selectedEngine.id}`, {
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
  }, [selectedEngine, step, creationMode, activeDaemon, token]);

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

  // Sync optimal flags preview
  useEffect(() => {
    const sizeString = ramUnit === 'GB' ? `${ramValue}G` : `${ramValue}M`;
    const flags = [`-Xms${sizeString}`, `-Xmx${sizeString}`, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled'];
    const ramMB = ramUnit === 'GB' ? ramValue * 1024 : ramValue;
    if (['paper', 'purpur', 'spigot'].includes(selectedEngine.id) && ramMB >= 2048) {
      flags.push('-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC');
    }
    setOptimalFlags(flags);
  }, [selectedEngine, ramValue, ramUnit]);

  // Long-polling download tracker
  useEffect(() => {
    let timer;
    if (isInstalling && createdInstanceId && activeDaemon && creationMode === 'download') {
      const checkProgress = () => {
        fetch(`/api/proxy/daemons/${activeDaemon.id}/instances/${createdInstanceId}/download-status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            setDownloadProgress(data);
            if (data.status === 'completed') {
              setIsInstalling(false);
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
  }, [isInstalling, createdInstanceId, activeDaemon, creationMode, token]);

  const handleBuild = async () => {
    if (!instanceName.trim()) return alert('Please enter an instance name.');
    
    setIsInstalling(true);
    const ramMB = ramUnit === 'GB' ? ramValue * 1024 : ramValue;

    try {
      const res = await fetch(`/api/proxy/daemons/${activeDaemon.id}/instances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: instanceName.trim(),
          edition: selectedEngine.id,
          version: selectedVersion || '1.20',
          ram: ramMB,
          dockerEnabled,
          path: customPath.trim(),
          linkExisting: creationMode === 'link',
          zipPath: creationMode === 'upload' ? uploadedZipPath : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger build/registration.');

      if (creationMode === 'link' || creationMode === 'upload') {
        // Linked nodes or extracts complete almost instantly, no long polling required!
        setIsInstalling(false);
        alert('Server instance created successfully!');
        onComplete({ id: data.instance.id });
      } else {
        setCreatedInstanceId(data.instance.id);
      }
    } catch (e) {
      alert(e.message);
      setIsInstalling(false);
    }
  };

  // ZIP File upload flow
  const triggerZipUpload = () => {
    zipInputRef.current?.click();
  };

  const handleZipFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      alert('Only .zip archives are allowed for server uploads.');
      return;
    }

    setZipUploadProgress(0);
    setUploadedZipPath('');
    setUploadedZipName(file.name);

    const xhr = new XMLHttpRequest();
    const url = `/api/proxy/daemons/${activeDaemon.id}/files/upload`;
    
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setZipUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setZipUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          setUploadedZipPath(resp.filePath);
        } catch (err) {
          alert('Upload completed but daemon response could not be parsed.');
        }
      } else {
        let errMessage = 'File upload failed.';
        try {
          const resp = JSON.parse(xhr.responseText);
          errMessage = resp.error || errMessage;
        } catch (e) {}
        alert(errMessage);
        setUploadedZipName('');
      }
    };

    xhr.onerror = () => {
      setZipUploadProgress(null);
      alert('Network error occurred during ZIP package upload.');
      setUploadedZipName('');
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  };

  const getStepLabels = () => {
    switch (creationMode) {
      case 'link':
        return ['Creation Mode', 'Engine Selection', 'Host Folder Details', 'Hardware Allocation', 'Configure & Finish'];
      case 'upload':
        return ['Creation Mode', 'Engine Selection', 'ZIP File Upload', 'Hardware Allocation', 'Configure & Finish'];
      default:
        return ['Creation Mode', 'Engine Selection', 'Version scroll', 'Hardware Allocation', 'Configure & Finish'];
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

  const maxRamMB = Math.round(systemRam * 0.85); // restrict to 85% of physical limits
  const stepLabels = getStepLabels();

  // Rendering the build progress bar
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
          {creationMode === 'download' 
            ? 'We are downloading core server files, creating folders, and setting up properties configurations.' 
            : 'We are creating the server instance and initializing system directories.'}
        </p>

        {creationMode === 'download' && downloadProgress && (
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
        {stepLabels.map((label, idx) => (
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

      {/* STEP 1: Creation Mode selection */}
      {step === 1 && (
        <div>
          <h3 style={styles.stepTitle}>Choose Creation Method</h3>
          <p style={styles.stepDesc}>Decide how you want to set up your Minecraft server instance on the target node.</p>
          
          <div style={styles.creationModesGrid}>
            {/* Mode 1: Download Core */}
            <div
              className="card"
              style={{
                ...styles.modeCard,
                borderColor: creationMode === 'download' ? 'var(--color-green-primary)' : 'var(--border-color)',
                backgroundColor: creationMode === 'download' ? 'rgba(16, 185, 129, 0.03)' : 'var(--bg-secondary)',
              }}
              onClick={() => setCreationMode('download')}
            >
              <div style={styles.modeIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-green-primary)" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </div>
              <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>Download Fresh Core</h4>
              <p style={styles.modeText}>Directly pull the latest server core jar (Paper, Purpur, Fabric, Vanilla) from Mojang or community feeds.</p>
            </div>

            {/* Mode 2: Link Folder */}
            <div
              className="card"
              style={{
                ...styles.modeCard,
                borderColor: creationMode === 'link' ? 'var(--color-green-primary)' : 'var(--border-color)',
                backgroundColor: creationMode === 'link' ? 'rgba(16, 185, 129, 0.03)' : 'var(--bg-secondary)',
              }}
              onClick={() => setCreationMode('link')}
            >
              <div style={styles.modeIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </div>
              <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>Link Existing Host Folder</h4>
              <p style={styles.modeText}>Import an existing Minecraft server directory currently sitting on the node's local filesystems.</p>
            </div>

            {/* Mode 3: ZIP Upload */}
            <div
              className="card"
              style={{
                ...styles.modeCard,
                borderColor: creationMode === 'upload' ? 'var(--color-green-primary)' : 'var(--border-color)',
                backgroundColor: creationMode === 'upload' ? 'rgba(16, 185, 129, 0.03)' : 'var(--bg-secondary)',
              }}
              onClick={() => setCreationMode('upload')}
            >
              <div style={styles.modeIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-warm-primary)" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
              </div>
              <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>Upload Server ZIP</h4>
              <p style={styles.modeText}>Upload a packaged `.zip` of a pre-configured Minecraft server or template and let the daemon unzip it.</p>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Engine Selection */}
      {step === 2 && (
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

      {/* STEP 3: Mode-Specific Settings */}
      {/* 3a: Version scrolling (For download core mode) */}
      {step === 3 && creationMode === 'download' && (
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

      {/* 3b: Path specs (For Link existing mode) */}
      {step === 3 && creationMode === 'link' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={styles.stepTitle}>Host Directory Settings</h3>
          <p style={styles.stepDesc}>Specify where the existing Minecraft files are located on the remote daemon host.</p>
          
          <div style={styles.formItem}>
            <label style={styles.label}>Server Directory Path (on Linux host)</label>
            <input
              type="text"
              placeholder="e.g. /home/aura/servers/survival_old"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              required
            />
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Ensure this folder exists and contains your jar core and configs (like <code>server.properties</code>).
            </span>
          </div>

          <div style={styles.formItem}>
            <label style={styles.label}>Server Instance Name</label>
            <input
              type="text"
              placeholder="e.g. survival-old-import"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              required
            />
          </div>
        </div>
      )}

      {/* 3c: Zip package upload (For ZIP upload mode) */}
      {step === 3 && creationMode === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={styles.stepTitle}>ZIP Package Upload</h3>
          <p style={styles.stepDesc}>Select or drag a standard Minecraft server package (.zip) to upload to the remote host daemon.</p>

          <div 
            style={{
              ...styles.uploadArea,
              borderColor: uploadedZipPath ? 'var(--color-green-primary)' : 'var(--border-color)',
              backgroundColor: uploadedZipPath ? 'rgba(16, 185, 129, 0.02)' : 'rgba(0,0,0,0.1)'
            }}
            onClick={triggerZipUpload}
          >
            {uploadedZipPath ? (
              <div style={styles.uploadSuccessContainer}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-green-primary)" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span style={{ fontWeight: 600, color: 'var(--text-title)', marginTop: '8px' }}>Package Uploaded!</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', wordBreak: 'break-all', marginTop: '4px' }}>
                  {uploadedZipName}
                </span>
              </div>
            ) : zipUploadProgress !== null ? (
              <div style={{ width: '80%' }}>
                <span style={{ fontSize: '13px', display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>
                  Uploading core template zip...
                </span>
                <div style={styles.progressBarBg}>
                  <div style={{ ...styles.progressBarFill, width: `${zipUploadProgress}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span>Uploading files...</span>
                  <span>{zipUploadProgress}%</span>
                </div>
              </div>
            ) : (
              <div>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span style={{ display: 'block', fontWeight: 600, marginTop: '8px' }}>Select ZIP Server Archive</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Max upload bounds constrained by your node JRE.</span>
              </div>
            )}
            <input 
              type="file" 
              ref={zipInputRef} 
              style={{ display: 'none' }} 
              onChange={handleZipFileChange}
              accept=".zip"
            />
          </div>

          <div style={styles.formItem}>
            <label style={styles.label}>Extraction Folder Path (on Linux host)</label>
            <input
              type="text"
              placeholder="e.g. /home/aura/servers/modded-world"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              required
            />
          </div>

          <div style={styles.formItem}>
            <label style={styles.label}>Server Instance Name</label>
            <input
              type="text"
              placeholder="e.g. modded-instance"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              required
            />
          </div>
        </div>
      )}

      {/* STEP 4: Hardware Allocation */}
      {step === 4 && (
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

      {/* STEP 5: Execution choices & finish */}
      {step === 5 && (
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

          <div style={styles.formItem}>
            <label style={styles.label}>Absolute Server Directory Path (on node host)</label>
            <input
              type="text"
              placeholder="e.g. /home/aura/servers/survival-core"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
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

        {step < 5 ? (
          <button
            className="btn btn-primary"
            disabled={
              (step === 3 && creationMode === 'download' && !selectedVersion) ||
              (step === 3 && creationMode === 'upload' && !uploadedZipPath) ||
              (step === 3 && creationMode === 'link' && !customPath)
            }
            onClick={() => setStep(step + 1)}
          >
            Next Step
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleBuild}>
            {creationMode === 'link' ? 'Link Instance' : creationMode === 'upload' ? 'Extract & Setup' : 'Build Server Core'}
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
    maxWidth: '950px',
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
  creationModesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px',
    marginTop: '10px'
  },
  modeCard: {
    cursor: 'pointer',
    padding: '28px',
    transition: 'all var(--transition-normal)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    boxShadow: 'none'
  },
  modeIcon: {
    marginBottom: '20px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid var(--border-color)'
  },
  modeText: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5'
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
  uploadArea: {
    border: '2px dashed var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    padding: '40px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all var(--transition-normal)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px'
  },
  uploadSuccessContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
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
  switch: {
    position: 'relative',
    display: 'inline-block',
    width: '46px',
    height: '24px',
  }
};
