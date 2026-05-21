import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths - since we are running inside panel, __dirname is c:\Users\Angel\Documents\Projects\mc-panel-gravity\panel
const PANEL_DIR = __dirname;
const DAEMON_DIR = path.resolve(__dirname, '../daemon');

console.log('Starting handshake integration test...');
console.log('Panel directory:', PANEL_DIR);
console.log('Daemon directory:', DAEMON_DIR);

// Backup existing databases and configs to avoid corrupting user's actual setups
const PANEL_DB = path.join(PANEL_DIR, 'data/db.json');
const DAEMON_CONFIG = path.join(DAEMON_DIR, 'config.json');
const DAEMON_DB = path.join(DAEMON_DIR, 'data/db.json');

let backupPanelDb = null;
let backupDaemonConfig = null;
let backupDaemonDb = null;

if (fs.existsSync(PANEL_DB)) {
  backupPanelDb = fs.readFileSync(PANEL_DB, 'utf8');
  fs.unlinkSync(PANEL_DB);
}
if (fs.existsSync(DAEMON_CONFIG)) {
  backupDaemonConfig = fs.readFileSync(DAEMON_CONFIG, 'utf8');
  fs.unlinkSync(DAEMON_CONFIG);
}
if (fs.existsSync(DAEMON_DB)) {
  backupDaemonDb = fs.readFileSync(DAEMON_DB, 'utf8');
  fs.unlinkSync(DAEMON_DB);
}

let daemonProcess = null;
let panelProcess = null;

function cleanup() {
  console.log('Cleaning up processes...');
  if (daemonProcess) daemonProcess.kill('SIGKILL');
  if (panelProcess) panelProcess.kill('SIGKILL');

  console.log('Restoring database and config backups...');
  try {
    if (backupPanelDb) fs.writeFileSync(PANEL_DB, backupPanelDb, 'utf8');
    else if (fs.existsSync(PANEL_DB)) fs.unlinkSync(PANEL_DB);

    if (backupDaemonConfig) fs.writeFileSync(DAEMON_CONFIG, backupDaemonConfig, 'utf8');
    else if (fs.existsSync(DAEMON_CONFIG)) fs.unlinkSync(DAEMON_CONFIG);

    if (backupDaemonDb) fs.writeFileSync(DAEMON_DB, backupDaemonDb, 'utf8');
    else if (fs.existsSync(DAEMON_DB)) fs.unlinkSync(DAEMON_DB);
  } catch (e) {
    console.error('Failed to restore some backups:', e.message);
  }
}

// Ensure cleanup runs on exit
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

async function run() {
  try {
    // 1. Launch Daemon Process
    console.log('Launching AuraDaemon...');
    daemonProcess = spawn('node', ['src/server.js'], {
      cwd: DAEMON_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: '21013' }
    });

    daemonProcess.stderr.on('data', (data) => {
      console.error('[Daemon stderr]', data.toString().trim());
    });

    let daemonKey = '';
    
    // Read stdout to parse printed critical key
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for Daemon key')), 10000);
      daemonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('[Daemon stdout]', text.trim());
        if (text.includes('CRITICAL SECURITY KEY:')) {
          const match = text.match(/CRITICAL SECURITY KEY:\s*([a-f0-9]{32})/);
          if (match && match[1]) {
            daemonKey = match[1];
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    console.log('Parsed Daemon Security Key:', daemonKey);

    // 2. Launch Panel Process
    console.log('Launching AuraPanel...');
    panelProcess = spawn('node', ['src/server.js'], {
      cwd: PANEL_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: '3000' }
    });

    panelProcess.stderr.on('data', (data) => {
      console.error('[Panel stderr]', data.toString().trim());
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for Panel startup')), 10000);
      panelProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('[Panel stdout]', text.trim());
        if (text.includes('AuraPanel Web Proxy started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    console.log('Both processes are live and ready! Testing connection directly...');

    // 3. Directly ping the daemon via Axios to verify it accepts connection with correct key
    const statsRes = await axios.get('http://127.0.0.1:21013/api/system/stats', {
      headers: { 'X-Daemon-Key': daemonKey }
    });
    console.log('Daemon direct ping stats successful:', statsRes.data);

    // 4. Test panel init & register
    console.log('Initializing panel user...');
    await axios.post('http://127.0.0.1:3000/api/auth/register', {
      username: 'admin',
      password: 'password123'
    });
    console.log('Panel user registered successfully!');

    console.log('Logging in to get JWT token...');
    const loginRes = await axios.post('http://127.0.0.1:3000/api/auth/login', {
      username: 'admin',
      password: 'password123'
    });
    const token = loginRes.data.token;
    console.log('JWT Token retrieved!');

    // 5. Register daemon on the panel
    console.log('Registering daemon on the panel...');
    const regRes = await axios.post('http://127.0.0.1:3000/api/daemons', {
      name: 'Test Node',
      ip: '127.0.0.1',
      port: 21013,
      key: daemonKey
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const daemonId = regRes.data.daemon.id;
    console.log('Daemon registered successfully! Node ID:', daemonId);

    // 6. Request Connection Test from panel to daemon
    console.log('Requesting panel connection test...');
    const testRes = await axios.post(`http://127.0.0.1:3000/api/daemons/${daemonId}/test-connection`, {}, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Panel to Daemon Connection test result:', testRes.data);
    if (!testRes.data.success) {
      throw new Error('Connection handshake failed between panel and daemon: ' + testRes.data.error);
    }
    console.log('Handshake successful!');

    // 7. Request dynamic wildcard proxied route
    console.log('Testing wildcard request proxying...');
    const proxyRes = await axios.get(`http://127.0.0.1:3000/api/proxy/daemons/${daemonId}/system/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Proxied System Stats via Panel:', proxyRes.data);
    if (!proxyRes.data.totalMemory) {
      throw new Error('Proxied system stats response is invalid.');
    }
    console.log('Wildcard Request Proxying works perfectly!');

    console.log('====================================================');
    console.log(' INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
    console.log(' All components function correctly!');
    console.log('====================================================');
    process.exit(0);

  } catch (error) {
    console.error('HANDSHAKE TEST FAILED!', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
    process.exit(1);
  }
}

run();
