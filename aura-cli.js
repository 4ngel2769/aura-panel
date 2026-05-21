#!/usr/bin/env node

/**
 * Aura CLI Helper Tool
 * Command: aura [status | nodes ls | instances ls | instance <id> stop | instance <id> console | healthchecks]
 * ZERO dependencies - built using Node.js core modules.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import readline from 'readline';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const AURA_ROOT = process.env.AURA_ROOT || '/opt/aura';

// ANSI Styling Colors
const C = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m'
};

// Paths Resolver
function getPaths() {
  // Check if relative development directories exist
  const devPanelDb = path.resolve(__dirname, 'panel/data/db.json');
  const devDaemonConfig = path.resolve(__dirname, 'daemon/config.json');
  const devDaemonDb = path.resolve(__dirname, 'daemon/data/db.json');

  return {
    panelDb: fs.existsSync(devPanelDb) ? devPanelDb : path.join(AURA_ROOT, 'panel/data/db.json'),
    daemonConfig: fs.existsSync(devDaemonConfig) ? devDaemonConfig : path.join(AURA_ROOT, 'daemon/config.json'),
    daemonDb: fs.existsSync(devDaemonDb) ? devDaemonDb : path.join(AURA_ROOT, 'daemon/data/db.json')
  };
}

const PATHS = getPaths();

// Core HTTP Client Utility
function makeRequest(urlStr, method = 'GET', headers = {}, body = null, timeout = 2000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const reqHeaders = {
        'Accept': 'application/json',
        ...headers
      };
      
      let postData = null;
      if (body) {
        postData = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: method.toUpperCase(),
        headers: reqHeaders,
        timeout: timeout
      }, (res) => {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => rawData += chunk);
        res.on('end', () => {
          try {
            const parsedData = rawData ? JSON.parse(rawData) : null;
            resolve({ success: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsedData });
          } catch (e) {
            resolve({ success: false, status: res.statusCode, error: 'JSON_PARSE_ERROR', raw: rawData });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'TIMEOUT', details: 'Request timed out' });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: 'NET_ERROR', details: err.message });
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    } catch (err) {
      resolve({ success: false, error: 'INVALID_URL', details: err.message });
    }
  });
}

// WebSocket Connection Utility (Pure Node.js)
function connectWebSocket(urlStr, onMessage, onError, onClose) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr);
      const key = crypto.randomBytes(16).toString('base64');
      
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13'
        }
      });

      req.on('upgrade', (res, socket, upgradeHead) => {
        let buffer = Buffer.alloc(0);
        
        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          
          while (buffer.length >= 2) {
            const firstByte = buffer[0];
            const secondByte = buffer[1];
            const opcode = firstByte & 0x0f;
            const hasMask = (secondByte & 0x80) !== 0;
            let payloadLength = secondByte & 0x7f;
            
            let headerLength = 2;
            if (payloadLength === 126) {
              if (buffer.length < 4) break;
              payloadLength = buffer.readUInt16BE(2);
              headerLength += 2;
            } else if (payloadLength === 127) {
              if (buffer.length < 10) break;
              payloadLength = Number(buffer.readBigUInt64BE(2)); // safe integer limit assumed
              headerLength += 8;
            }
            
            let maskKey;
            if (hasMask) {
              if (buffer.length < headerLength + 4) break;
              maskKey = buffer.subarray(headerLength, headerLength + 4);
              headerLength += 4;
            }
            
            if (buffer.length < headerLength + payloadLength) break;
            
            const rawPayload = buffer.subarray(headerLength, headerLength + payloadLength);
            buffer = buffer.subarray(headerLength + payloadLength);
            
            let payload = rawPayload;
            if (hasMask && maskKey) {
              payload = Buffer.alloc(payloadLength);
              for (let i = 0; i < payloadLength; i++) {
                payload[i] = rawPayload[i] ^ maskKey[i % 4];
              }
            }
            
            if (opcode === 1) { // Text
              onMessage(payload.toString('utf8'));
            } else if (opcode === 8) { // Close
              socket.end();
              if (onClose) onClose();
              return;
            }
          }
        });

        socket.on('error', (err) => {
          if (onError) onError(err);
        });

        socket.on('close', () => {
          if (onClose) onClose();
        });

        socket.sendText = (text) => {
          const payload = Buffer.from(text, 'utf8');
          const payloadLen = payload.length;
          
          let header;
          if (payloadLen <= 125) {
            header = Buffer.alloc(6);
            header[0] = 0x81;
            header[1] = 0x80 | payloadLen;
          } else if (payloadLen <= 65535) {
            header = Buffer.alloc(8);
            header[0] = 0x81;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(payloadLen, 2);
          } else {
            header = Buffer.alloc(14);
            header[0] = 0x81;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(payloadLen), 2);
          }
          
          const maskKey = crypto.randomBytes(4);
          const maskOffset = header.length - 4;
          maskKey.copy(header, maskOffset);
          
          const maskedPayload = Buffer.alloc(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            maskedPayload[i] = payload[i] ^ maskKey[i % 4];
          }
          
          socket.write(Buffer.concat([header, maskedPayload]));
        };

        resolve(socket);
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// System Command Runner Helper
function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch (e) {
    return '';
  }
}

// ----------------------------------------------------
// COMMAND HANDLERS
// ----------------------------------------------------

// 1. aura status
function handleStatus() {
  console.log(`${C.bright}${C.blue}=== Aura Platform Status ===${C.reset}\n`);

  // Service statuses
  const hasSystemctl = runCmd('which systemctl');
  if (hasSystemctl) {
    const services = ['aura-panel', 'aura-daemon'];
    services.forEach(service => {
      const activeState = runCmd(`systemctl is-active ${service}`);
      let statusStr = `${C.red}● INACTIVE${C.reset}`;
      if (activeState === 'active') {
        statusStr = `${C.green}● ACTIVE (Running)${C.reset}`;
      } else if (activeState === 'failed') {
        statusStr = `${C.red}● FAILED${C.reset}`;
      }
      
      const desc = service === 'aura-panel' ? 'Aura Central Web UI Controller' : 'Aura Lightweight Server Runner';
      console.log(`${C.bright}${service}${C.reset} (${desc})`);
      console.log(`  Status: ${statusStr}`);
      
      // Grab main PID and memory load from systemctl if running
      if (activeState === 'active') {
        const info = runCmd(`systemctl show ${service} --property=MainPID --property=ActiveEnterTimestampMonotonic`);
        console.log(`  ${C.gray}${info.replace(/\n/g, ' | ')}${C.reset}`);
      }
      console.log();
    });
  } else {
    console.log(`${C.yellow}Systemd is not available. Skipping service state queries.${C.reset}\n`);
  }

  // OS Info
  console.log(`${C.bright}OS Information:${C.reset}`);
  console.log(`  Platform: ${os.platform()} (${os.arch()})`);
  console.log(`  Release:  ${os.release()}`);
  console.log(`  Uptime:   ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`);
  console.log();

  // Hardware Loads
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = Math.round((usedMem / totalMem) * 100);

  // visual bar
  const barLen = 20;
  const activeChars = Math.round((memPct / 100) * barLen);
  const bar = `[${C.green}${'#'.repeat(activeChars)}${C.gray}${'-'.repeat(barLen - activeChars)}${C.reset}]`;

  console.log(`${C.bright}System Resource Utilization:${C.reset}`);
  console.log(`  CPU Model:    ${cpus[0]?.model || 'Unknown CPU'}`);
  console.log(`  CPU Cores:    ${cpus.length}`);
  console.log(`  Load Average: ${os.loadavg().map(v => v.toFixed(2)).join(', ')}`);
  console.log(`  Memory Usage: ${bar} ${memPct}% (${(usedMem / (1024**3)).toFixed(2)} GB / ${(totalMem / (1024**3)).toFixed(2)} GB)`);
  console.log();
}

// 2. aura nodes ls
async function handleNodesLs() {
  if (!fs.existsSync(PATHS.panelDb)) {
    console.error(`${C.red}Error: Panel database file not found at ${PATHS.panelDb}.${C.reset}`);
    console.error(`Ensure AuraPanel is installed or AURA_ROOT environment variable is set correctly.`);
    return;
  }

  try {
    const db = JSON.parse(fs.readFileSync(PATHS.panelDb, 'utf8'));
    const daemons = db.daemons || [];

    console.log(`${C.bright}${C.cyan}Registered Daemons (Nodes):${C.reset}`);
    if (daemons.length === 0) {
      console.log(`  No nodes registered in the panel database.`);
      return;
    }

    console.log(`\n  ${C.bright}${'ID'.padEnd(20)} ${'Node Name'.padEnd(22)} ${'Endpoint'.padEnd(22)} ${'Status'.padEnd(10)}${C.reset}`);
    console.log(`  ${'-'.repeat(78)}`);

    const checks = daemons.map(async (d) => {
      // test connection
      const testUrl = `http://${d.ip}:${d.port}/api/system/stats`;
      const res = await makeRequest(testUrl, 'GET', { 'X-Daemon-Key': d.key }, null, 1500);
      const statusStr = res.success ? `${C.green}ONLINE${C.reset}` : `${C.red}OFFLINE${C.reset}`;
      
      console.log(`  ${d.id.padEnd(20)} ${d.name.substring(0, 20).padEnd(22)} `${d.ip}:${d.port}`.substring(0, 22).padEnd(22)} ${statusStr}`);
    });

    await Promise.all(checks);
    console.log();
  } catch (e) {
    console.error(`${C.red}Failed to read or parse panel database: ${e.message}${C.reset}`);
  }
}

// Helper to scan and return instances
async function getAggregatedInstances() {
  let allInstances = [];

  // 1. Gather remote daemon instances registered in Panel DB
  if (fs.existsSync(PATHS.panelDb)) {
    try {
      const db = JSON.parse(fs.readFileSync(PATHS.panelDb, 'utf8'));
      const daemons = db.daemons || [];
      
      const fetchList = daemons.map(async (d) => {
        const url = `http://${d.ip}:${d.port}/api/instances`;
        const res = await makeRequest(url, 'GET', { 'X-Daemon-Key': d.key }, null, 1500);
        if (res.success && Array.isArray(res.data)) {
          res.data.forEach(inst => {
            allInstances.push({
              ...inst,
              nodeName: d.name,
              nodeIp: d.ip,
              nodePort: d.port,
              nodeKey: d.key,
              isLocal: false
            });
          });
        }
      });
      await Promise.all(fetchList);
    } catch (e) {}
  }

  // 2. Gather local daemon instances if local DB exists
  if (fs.existsSync(PATHS.daemonDb)) {
    try {
      const db = JSON.parse(fs.readFileSync(PATHS.daemonDb, 'utf8'));
      const config = fs.existsSync(PATHS.daemonConfig) ? JSON.parse(fs.readFileSync(PATHS.daemonConfig, 'utf8')) : null;
      const instances = db.instances || [];

      instances.forEach(inst => {
        // Prevent duplication if already fetched through Panel query
        if (!allInstances.some(ai => ai.id === inst.id)) {
          allInstances.push({
            ...inst,
            nodeName: config ? config.name : 'LocalDaemon',
            nodeIp: config ? config.address : '127.0.0.1',
            nodePort: config ? config.port : 21013,
            nodeKey: config ? config.key : '',
            isLocal: true
          });
        }
      });
    } catch (e) {}
  }

  return allInstances;
}

// 3. aura instances ls
async function handleInstancesLs() {
  console.log(`${C.bright}${C.cyan}Scanning Minecraft Server Instances...${C.reset}`);
  const instances = await getAggregatedInstances();

  if (instances.length === 0) {
    console.log(`\n  No active or offline instances found.`);
    console.log(`  Ensure your daemons are online and instances are created.`);
    return;
  }

  console.log(`\n  ${C.bright}${'Instance ID'.padEnd(16)} ${'Name'.padEnd(20)} ${'Edition/Ver'.padEnd(18)} ${'Port'.padEnd(7)} ${'Status'.padEnd(12)} ${'Node/Host'}${C.reset}`);
  console.log(`  ${'-'.repeat(85)}`);

  instances.forEach(i => {
    let statColor = C.gray;
    if (i.status === 'running') statColor = C.green;
    if (i.status === 'stopped') statColor = C.yellow;
    if (i.status === 'starting') statColor = C.cyan;
    if (i.status === 'failed') statColor = C.red;

    const versionStr = `${i.edition}/${i.version}`;
    console.log(`  ${i.id.padEnd(16)} ${i.name.substring(0, 18).padEnd(20)} ${versionStr.substring(0, 16).padEnd(18)} ${String(i.port || '').padEnd(7)} ${`${statColor}${i.status.toUpperCase()}${C.reset}`.padEnd(21)} ${i.nodeName}`);
  });
  console.log();
}

// 4. aura instance <id> stop
async function handleInstanceStop(instanceId) {
  if (!instanceId) {
    console.error(`${C.red}Error: Missing instance ID. Usage: aura instance <instance-id> stop${C.reset}`);
    return;
  }

  console.log(`Searching for instance ${C.bright}${instanceId}${C.reset}...`);
  const instances = await getAggregatedInstances();
  const target = instances.find(i => i.id === instanceId);

  if (!target) {
    console.error(`${C.red}Error: Instance "${instanceId}" not found in local registries or registered nodes.${C.reset}`);
    return;
  }

  console.log(`Sending Stop signal to node ${C.bright}${target.nodeName}${C.reset} (${target.nodeIp}:${target.nodePort})...`);
  const url = `http://${target.nodeIp}:${target.nodePort}/api/instances/${instanceId}/stop`;
  const res = await makeRequest(url, 'POST', { 'X-Daemon-Key': target.nodeKey }, null, 5000);

  if (res.success) {
    console.log(`${C.green}✔ Success: Stop command issued to instance ${instanceId}.${C.reset}`);
  } else {
    console.error(`${C.red}✘ Failed to stop instance: ${res.data?.error || res.error || 'Unknown Error'}${C.reset}`);
  }
}

// 5. aura instance <id> console
async function handleInstanceConsole(instanceId) {
  if (!instanceId) {
    console.error(`${C.red}Error: Missing instance ID. Usage: aura instance <instance-id> console${C.reset}`);
    return;
  }

  console.log(`Searching for instance ${C.bright}${instanceId}${C.reset}...`);
  const instances = await getAggregatedInstances();
  const target = instances.find(i => i.id === instanceId);

  if (!target) {
    console.error(`${C.red}Error: Instance "${instanceId}" not found in local registries or registered nodes.${C.reset}`);
    return;
  }

  // Socket setup
  const ip = target.nodeIp === '0.0.0.0' ? '127.0.0.1' : target.nodeIp;
  const wsUrl = `ws://${ip}:${target.nodePort}/api/ws?key=${target.nodeKey}&instanceId=${instanceId}`;

  console.log(`${C.cyan}Connecting to socket ${C.dim}${wsUrl}...${C.reset}`);
  
  let wsSocket = null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ''
  });

  try {
    wsSocket = await connectWebSocket(
      wsUrl,
      (msg) => {
        // Message handler
        try {
          const payload = JSON.parse(msg);
          if (payload.type === 'history' && Array.isArray(payload.data)) {
            console.log(`${C.gray}--- LOG HISTORY START ---${C.reset}`);
            payload.data.forEach(line => console.log(line.trim()));
            console.log(`${C.gray}--- LOG HISTORY END ---${C.reset}`);
          } else if (payload.type === 'log') {
            console.log(payload.data.trim());
          } else if (payload.type === 'stats') {
            // Silently ignore stats loops in interactive CLI console to avoid clogging terminal
          }
        } catch (e) {
          console.log(msg.trim());
        }
      },
      (err) => {
        console.error(`\n${C.red}WebSocket Error: ${err.message}${C.reset}`);
        rl.close();
      },
      () => {
        console.log(`\n${C.yellow}Console connection closed by the remote node.${C.reset}`);
        rl.close();
        process.exit(0);
      }
    );

    console.log(`${C.green}Connected! Console interactive. Type commands and press ENTER to execute.${C.reset}`);
    console.log(`${C.gray}Press Ctrl+C to close console tunnel.${C.reset}\n`);

    rl.on('line', (line) => {
      const clean = line.trim();
      if (clean.toLowerCase() === 'exit') {
        console.log('Exiting console.');
        rl.close();
        wsSocket.end();
        process.exit(0);
      }
      if (wsSocket && wsSocket.writable) {
        wsSocket.sendText(clean);
      }
    });

  } catch (err) {
    console.error(`${C.red}Connection failed: ${err.message}${C.reset}`);
    rl.close();
  }
}

// 6. aura healthchecks
function handleHealthchecks() {
  console.log(`${C.bright}${C.blue}=== Running System Healthchecks ===${C.reset}\n`);
  let warningCount = 0;
  let criticalCount = 0;

  function report(name, status, details = '') {
    let mark = '';
    if (status === 'OK') {
      mark = `${C.green}✔ OK${C.reset}`;
    } else if (status === 'WARNING') {
      mark = `${C.yellow}⚠ WARNING${C.reset}`;
      warningCount++;
    } else {
      mark = `${C.red}✘ CRITICAL${C.reset}`;
      criticalCount++;
    }
    console.log(`  [${mark}] ${C.bright}${name}${C.reset}`);
    if (details) console.log(`       ${C.gray}${details}${C.reset}`);
  }

  // 1. Node.js Version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  if (major >= 18) {
    report('Node.js runtime version', 'OK', `${nodeVer} (Minimum required: >= v18)`);
  } else {
    report('Node.js runtime version', 'CRITICAL', `${nodeVer} (AuraPanel requires Node.js v18+)`);
  }

  // 2. Java version
  const javaPath = runCmd('which java');
  if (javaPath) {
    const javaVer = runCmd('java -version 2>&1').split('\n')[0] || 'Unknown';
    report('Java Runtime Environment', 'OK', `${javaVer} found at ${javaPath}`);
  } else {
    report('Java Runtime Environment', 'WARNING', `No Java executable found. Minecraft Java Edition servers require Java installed on the node.`);
  }

  // 3. Docker status
  const dockerPath = runCmd('which docker');
  if (dockerPath) {
    const dockerRun = runCmd('docker info 2>&1');
    if (dockerRun.includes('Cannot connect to the Docker daemon') || dockerRun.includes('error during connect')) {
      report('Docker engine', 'WARNING', `Docker is installed but the daemon is not running or the current user lacks socket permissions.`);
    } else {
      report('Docker engine', 'OK', `Docker engine is operational. Containers can be launched.`);
    }
  } else {
    report('Docker engine', 'WARNING', `Docker command not found. Containerized server virtualization will be disabled.`);
  }

  // 4. Git availability
  const gitPath = runCmd('which git');
  if (gitPath) {
    report('Git Version Control', 'OK', `Git is available: ${runCmd('git --version')}`);
  } else {
    report('Git Version Control', 'WARNING', `Git is not installed. Git setups might fail.`);
  }

  // 5. Directories and Permissions
  const pathsToCheck = ['/opt/aura', '/home/aura/servers'];
  pathsToCheck.forEach(pth => {
    if (fs.existsSync(pth)) {
      try {
        fs.accessSync(pth, fs.constants.R_OK | fs.constants.W_OK);
        report(`Directory Permissions: ${pth}`, 'OK', `Writable and readable.`);
      } catch (e) {
        report(`Directory Permissions: ${pth}`, 'CRITICAL', `Directory exists but is not readable/writable: ${e.message}`);
      }
    } else {
      // Try to check if parent is writable
      const parent = path.dirname(pth);
      if (fs.existsSync(parent)) {
        try {
          fs.accessSync(parent, fs.constants.W_OK);
          report(`Directory Path: ${pth}`, 'OK', `Does not exist yet but parent directory ${parent} is writable.`);
        } catch (e) {
          report(`Directory Path: ${pth}`, 'WARNING', `Parent path ${parent} is not writable. Automatic setup may fail.`);
        }
      } else {
        report(`Directory Path: ${pth}`, 'WARNING', `Base structure directory not found. Run aura-install.sh first.`);
      }
    }
  });

  // 6. Ports bindings checks
  const portChecks = [3000, 21013];
  portChecks.forEach(port => {
    // Check if port is locked via standard ss/netstat
    const locked = runCmd(`ss -tulpn | grep :${port}`) || runCmd(`netstat -an | grep :${port}`);
    if (locked) {
      report(`Port ${port} listener`, 'WARNING', `Port ${port} is currently in use. Check process bindings.`);
    } else {
      report(`Port ${port} listener`, 'OK', `Port is available.`);
    }
  });

  console.log(`\nHealthcheck Summary: ${C.bright}${criticalCount} Criticals${C.reset}, ${C.bright}${warningCount} Warnings${C.reset}.\n`);
}

// ----------------------------------------------------
// MAIN ROUTING
// ----------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || ['-h', '--help', 'help'].includes(args[0])) {
    showHelp();
    return;
  }

  const primary = args[0].toLowerCase();

  switch (primary) {
    case 'status':
      handleStatus();
      break;

    case 'nodes':
      if (args[1] === 'ls') {
        await handleNodesLs();
      } else {
        console.error(`${C.red}Unknown subcommand "${args[1]}". Did you mean: aura nodes ls?${C.reset}`);
      }
      break;

    case 'instances':
      if (args[1] === 'ls') {
        await handleInstancesLs();
      } else {
        console.error(`${C.red}Unknown subcommand "${args[1]}". Did you mean: aura instances ls?${C.reset}`);
      }
      break;

    case 'instance':
      const instId = args[1];
      const action = args[2]?.toLowerCase();
      if (!instId) {
        console.error(`${C.red}Error: Missing instance ID. Usage: aura instance <id> [stop | console]${C.reset}`);
        break;
      }
      if (action === 'stop') {
        await handleInstanceStop(instId);
      } else if (action === 'console') {
        await handleInstanceConsole(instId);
      } else {
        console.error(`${C.red}Unknown instance subcommand "${args[2]}". Supported: stop, console${C.reset}`);
      }
      break;

    case 'healthchecks':
      handleHealthchecks();
      break;

    default:
      console.error(`${C.red}Unknown command "${primary}".${C.reset}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
${C.bright}${C.green}Aura Platform Administration CLI Helper${C.reset}

${C.bright}Usage:${C.reset}
  aura status                       Check service status and host machine load metrics
  aura nodes ls                     List all registered daemon nodes and their online states
  aura instances ls                 List all Minecraft server instances across nodes
  aura instance <id> stop           Safely stop a specific Minecraft server instance
  aura instance <id> console        Open interactive terminal console to a server instance
  aura healthchecks                 Validate local environment requirements, JRE, Docker, and ports
`);
}

main().catch(e => {
  console.error(`${C.red}Critical CLI failure: ${e.message}${C.reset}`);
  process.exit(1);
});
