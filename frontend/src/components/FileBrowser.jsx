import React, { useState, useEffect, useRef } from 'react';

export default function FileBrowser({ token, activeDaemon, instance }) {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Modals / Dialogs states
  const [editingFile, setEditingFile] = useState(null); // { name, path, content }
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  
  // File Upload states
  const [uploadProgress, setUploadProgress] = useState(null); // percent 0-100
  const fileInputRef = useRef(null);

  // Load items whenever path or daemon changes
  const fetchDirectory = (dirPath) => {
    if (!activeDaemon || !dirPath || !instance?.id) return;
    setLoading(true);
    setError('');
    
    // Pass instanceId to ensure we are scoped to the correct directory
    const url = `/api/proxy/daemons/\${activeDaemon.id}/files/list?path=\${encodeURIComponent(dirPath)}&instanceId=\${instance.id}`;
    
    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to read directory.');
        // Sort folders first, then files alphabetically
        const sorted = data.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        setItems(sorted);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || 'Connection to daemon directory failed.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (instance?.id) {
      setCurrentPath('/');
      fetchDirectory('/');
    }
  }, [instance, activeDaemon]);

  const handleRefresh = () => {
    fetchDirectory(currentPath);
  };

  // Directory navigation helpers
  const handleFolderClick = (folderName) => {
    // Add path separator depending on windows/linux. Linux is standard for daemon target.
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const newPath = currentPath.endsWith(separator) 
      ? `${currentPath}${folderName}` 
      : `${currentPath}${separator}${folderName}`;
    setCurrentPath(newPath);
    fetchDirectory(newPath);
  };

  const handleBackClick = () => {
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator);
    // Remove last part if not empty
    if (parts.length > 1) {
      if (parts[parts.length - 1] === '') parts.pop();
      parts.pop();
      let parentPath = parts.join(separator);
      if (parentPath === '' && separator === '/') parentPath = '/'; // root path
      setCurrentPath(parentPath);
      fetchDirectory(parentPath);
    }
  };

  // Breadcrumbs jump
  const handleBreadcrumbClick = (index) => {
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    const selectedParts = parts.slice(0, index + 1);
    let newPath = (currentPath.startsWith('/') ? '/' : '') + selectedParts.join(separator);
    setCurrentPath(newPath);
    fetchDirectory(newPath);
  };

  // Read File content
  const handleOpenFile = (fileItem) => {
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const filePath = currentPath.endsWith(separator)
      ? `${currentPath}${fileItem.name}`
      : `${currentPath}${separator}${fileItem.name}`;

    setLoading(true);
    fetch(`/api/proxy/daemons/\${activeDaemon.id}/files/read?path=\${encodeURIComponent(filePath)}&instanceId=\${instance.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setEditingFile({
          name: fileItem.name,
          path: filePath,
          content: data.content || ''
        });
      })
      .catch(err => {
        alert(`Failed to load file contents: ${err.message}`);
      })
      .finally(() => setLoading(false));
  };

  // Save File contents
  const handleSaveFile = () => {
    if (!editingFile) return;
    setIsSavingFile(true);

    fetch(`/api/proxy/daemons/${activeDaemon.id}/files/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        path: editingFile.path,
        content: editingFile.content,
        instanceId: instance.id
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setEditingFile(null);
        handleRefresh();
      })
      .catch(err => {
        alert(`Failed to save file: ${err.message}`);
      })
      .finally(() => setIsSavingFile(false));
  };

  // Create folder
  const handleCreateFolder = (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    const separator = currentPath.includes('\\') ? '\\' : '/';
    const newDirPath = currentPath.endsWith(separator)
      ? `${currentPath}${newFolderName.trim()}`
      : `${currentPath}${separator}${newFolderName.trim()}`;

    fetch(`/api/proxy/daemons/${activeDaemon.id}/files/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ path: newDirPath, instanceId: instance.id })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setNewFolderName('');
        setShowNewFolderModal(false);
        handleRefresh();
      })
      .catch(err => {
        alert(`Failed to create directory: ${err.message}`);
      });
  };

  // Create empty file
  const handleCreateFile = (e) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const separator = currentPath.includes('\\') ? '\\' : '/';
    const newFilePath = currentPath.endsWith(separator)
      ? `${currentPath}${newFileName.trim()}`
      : `${currentPath}${separator}${newFileName.trim()}`;

    fetch(`/api/proxy/daemons/${activeDaemon.id}/files/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ path: newFilePath, content: '', instanceId: instance.id })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setNewFileName('');
        setShowNewFileModal(false);
        handleRefresh();
      })
      .catch(err => {
        alert(`Failed to create file: ${err.message}`);
      });
  };

  // Delete item
  const handleDelete = (item) => {
    const confirm = window.confirm(`Are you sure you want to permanently delete "${item.name}"?`);
    if (!confirm) return;

    const separator = currentPath.includes('\\') ? '\\' : '/';
    const itemPath = currentPath.endsWith(separator)
      ? `${currentPath}${item.name}`
      : `${currentPath}${separator}${item.name}`;

    fetch(`/api/proxy/daemons/${activeDaemon.id}/files/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ path: itemPath, instanceId: instance.id })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        handleRefresh();
      })
      .catch(err => {
        alert(`Failed to delete path: ${err.message}`);
      });
  };

  // Unzip archive
  const handleUnzip = (item) => {
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const zipPath = currentPath.endsWith(separator) ? `${currentPath}${item.name}` : `${currentPath}${separator}${item.name}`;
    
    const confirm = window.confirm(`Extract "${item.name}" into current directory?`);
    if (!confirm) return;

    setLoading(true);
    fetch(`/api/proxy/daemons/${activeDaemon.id}/files/unzip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        zipPath,
        targetDir: currentPath,
        instanceId: instance.id
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        alert('Extraction completed successfully!');
        handleRefresh();
      })
      .catch(err => {
        alert(`Failed to extract archive: ${err.message}`);
      })
      .finally(() => setLoading(false));
  };

  // File Upload flow
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadFile(file);
  };

  const uploadFile = (file) => {
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const targetPath = currentPath.endsWith(separator)
      ? `${currentPath}${file.name}`
      : `${currentPath}${separator}${file.name}`;

    setUploadProgress(0);
    
    const xhr = new XMLHttpRequest();
    const url = `/api/proxy/daemons/\${activeDaemon.id}/files/upload?targetPath=\${encodeURIComponent(targetPath)}&instanceId=\${instance.id}`;
    
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    
    // Track upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        handleRefresh();
      } else {
        let errMessage = 'File upload failed.';
        try {
          const resp = JSON.parse(xhr.responseText);
          errMessage = resp.error || errMessage;
        } catch (e) {}
        alert(errMessage);
      }
    };

    xhr.onerror = () => {
      setUploadProgress(null);
      alert('Network error occurred during file upload.');
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  };

  // Formatter utilities
  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleString();
  };

  const getFileIcon = (item) => {
    if (item.isDirectory) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-green-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      );
    }
    
    const ext = item.name.split('.').pop().toLowerCase();
    if (ext === 'zip') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-warm-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      );
    }
    
    if (['properties', 'yml', 'yaml', 'json'].includes(ext)) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      );
    }

    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
    );
  };

  // Render breadcrumbs neatly
  const separator = currentPath.includes('\\') ? '\\' : '/';
  const breadcrumbParts = currentPath.split(separator).filter(Boolean);

  return (
    <div className="card animate-fade-in" style={styles.browserContainer}>
      {/* File Browser Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.navigationControls}>
          <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={handleBackClick} disabled={currentPath === '/' || currentPath === '\\' || currentPath === ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          
          <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={handleRefresh}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''}>
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>

          {/* Breadcrumbs */}
          <div style={styles.breadcrumbs}>
            <span style={styles.breadcrumbItem} onClick={() => {
              setCurrentPath(instance?.path || '');
              fetchDirectory(instance?.path || '');
            }}>
              root
            </span>
            {breadcrumbParts.map((part, idx) => (
              <React.Fragment key={idx}>
                <span style={{ color: 'var(--text-disabled)' }}>/</span>
                <span style={styles.breadcrumbItem} onClick={() => handleBreadcrumbClick(idx)}>
                  {part}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => setShowNewFolderModal(true)}>
            + New Folder
          </button>
          <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => setShowNewFileModal(true)}>
            + New File
          </button>
          <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={handleUploadClick}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Upload
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileChange} 
          />
        </div>
      </div>

      {/* Uploading indicator */}
      {uploadProgress !== null && (
        <div style={styles.uploadProgressBanner}>
          <div style={styles.uploadTextRow}>
            <span>Uploading server files...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div style={styles.uploadProgressBg}>
            <div style={{ ...styles.uploadProgressFill, width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* Explorer Path label */}
      <div style={styles.pathLabel}>
        <span style={{ fontSize: '11px', color: 'var(--text-disabled)', textTransform: 'uppercase', fontWeight: 600 }}>Active Directory:</span>
        <span style={styles.pathValue}>{currentPath}</span>
      </div>

      {/* Files List Table */}
      <div style={styles.explorerBody}>
        {error && (
          <div style={styles.errorBanner}>
            <span>Error: {error}</span>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div style={styles.emptyExplorer}>
            <div style={styles.loadingSpinner} />
            <span style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Querying remote storage nodes...</span>
          </div>
        ) : items.length === 0 ? (
          <div style={styles.emptyExplorer}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>This folder is empty.</span>
          </div>
        ) : (
          <table style={styles.explorerTable}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: '45%' }}>Name</th>
                <th style={{ ...styles.th, width: '20%' }}>Size</th>
                <th style={{ ...styles.th, width: '20%' }}>Last Modified</th>
                <th style={{ ...styles.th, width: '15%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} style={styles.trItem}>
                  <td style={styles.td}>
                    {item.isDirectory ? (
                      <div style={styles.itemClickable} onClick={() => handleFolderClick(item.name)}>
                        {getFileIcon(item)}
                        <span style={styles.itemNameFolder}>{item.name}</span>
                      </div>
                    ) : (
                      <div style={styles.itemClickable} onClick={() => handleOpenFile(item)}>
                        {getFileIcon(item)}
                        <span style={styles.itemNameFile}>{item.name}</span>
                      </div>
                    )}
                  </td>
                  <td style={{ ...styles.td, color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {item.isDirectory ? '-' : formatSize(item.size)}
                  </td>
                  <td style={{ ...styles.td, color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {formatDate(item.mtime)}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <div style={styles.actionsCell}>
                      {item.name.toLowerCase().endsWith('.zip') && (
                        <button 
                          className="btn btn-secondary" 
                          style={styles.actionBtnSmall} 
                          title="Extract Zip"
                          onClick={() => handleUnzip(item)}
                        >
                          Unzip
                        </button>
                      )}
                      <button 
                        className="btn btn-secondary" 
                        style={{ ...styles.actionBtnSmall, borderColor: 'var(--color-error)', color: 'var(--color-error)' }} 
                        title="Delete Item"
                        onClick={() => handleDelete(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Editor Modal */}
      {editingFile && (
        <div style={styles.modalOverlay}>
          <div className="card" style={styles.modalCard}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ fontSize: '18px' }}>Editing Configuration File</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{editingFile.name}</span>
              </div>
              <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => setEditingFile(null)}>
                ✕
              </button>
            </div>
            
            <div style={styles.modalBody}>
              <textarea
                style={styles.editorTextarea}
                value={editingFile.content}
                onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                spellCheck="false"
              />
            </div>

            <div style={styles.modalFooter}>
              <button className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => setEditingFile(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ padding: '8px 24px' }} disabled={isSavingFile} onClick={handleSaveFile}>
                {isSavingFile ? 'Saving...' : 'Save & Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div style={styles.modalOverlay}>
          <div className="card" style={{ ...styles.modalCard, maxWidth: '400px' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Create New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <input
                type="text"
                placeholder="Folder Name (e.g. plugins)"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                required
              />
              <div style={{ ...styles.modalFooter, marginTop: '24px', padding: 0, border: 'none' }}>
                <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '8px 20px' }}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New File Modal */}
      {showNewFileModal && (
        <div style={styles.modalOverlay}>
          <div className="card" style={{ ...styles.modalCard, maxWidth: '400px' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Create Empty File</h3>
            <form onSubmit={handleCreateFile}>
              <input
                type="text"
                placeholder="Filename (e.g. server.properties)"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                autoFocus
                required
              />
              <div style={{ ...styles.modalFooter, marginTop: '24px', padding: 0, border: 'none' }}>
                <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => {
                  setShowNewFileModal(false);
                  setNewFileName('');
                }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '8px 20px' }}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  browserContainer: {
    padding: '24px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    gap: '20px',
    flexWrap: 'wrap'
  },
  navigationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    backgroundColor: 'var(--bg-tertiary)',
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    color: 'var(--text-title)',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    maxWidth: '100%'
  },
  breadcrumbItem: {
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'color var(--transition-fast)',
    ':hover': {
      color: 'var(--color-green-primary)'
    }
  },
  pathLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    backgroundColor: 'rgba(0,0,0,0.15)',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.02)'
  },
  pathValue: {
    fontFamily: 'Fira Code, monospace',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  uploadProgressBanner: {
    backgroundColor: 'var(--bg-tertiary)',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    marginBottom: '20px'
  },
  uploadTextRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    marginBottom: '8px'
  },
  uploadProgressBg: {
    width: '100%',
    height: '6px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: 'var(--color-green-primary)',
    transition: 'width 0.2s ease'
  },
  explorerBody: {
    minHeight: '280px',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.1)'
  },
  emptyExplorer: {
    padding: '60px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center'
  },
  loadingSpinner: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '3px solid var(--border-color)',
    borderTopColor: 'var(--color-green-primary)',
    animation: 'spin 1s linear infinite'
  },
  errorBanner: {
    backgroundColor: 'var(--color-error-glow)',
    borderLeft: '4px solid var(--color-error)',
    padding: '12px 16px',
    margin: '12px',
    borderRadius: '4px',
    fontSize: '13px',
    color: 'var(--color-error)'
  },
  explorerTable: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left'
  },
  th: {
    padding: '14px 20px',
    backgroundColor: 'var(--bg-tertiary)',
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border-color)'
  },
  td: {
    padding: '12px 20px',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle'
  },
  trItem: {
    transition: 'background-color var(--transition-fast)',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.015)'
    }
  },
  itemClickable: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    userSelect: 'none'
  },
  itemNameFolder: {
    fontWeight: 600,
    color: 'var(--text-title)'
  },
  itemNameFile: {
    fontWeight: 400,
    color: 'var(--text-primary)'
  },
  actionsCell: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px'
  },
  actionBtnSmall: {
    padding: '4px 10px',
    fontSize: '11px',
    borderRadius: '4px'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalCard: {
    width: '90%',
    maxWidth: '850px',
    padding: '28px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-focus)',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    borderRadius: '16px'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '16px'
  },
  modalBody: {
    flex: 1,
    minHeight: '300px',
    display: 'flex',
    flexDirection: 'column'
  },
  editorTextarea: {
    flex: 1,
    fontFamily: 'Fira Code, monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '16px',
    color: 'var(--text-primary)',
    resize: 'none',
    minHeight: '350px'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '16px'
  }
};
