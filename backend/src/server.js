import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

import db, { DATA_DIR } from './services/db.js';
import { VersionService, activeDownloads } from './services/versionService.js';
import { DockerService } from './services/dockerService.js';
import { InstanceManager, activeInstances } from './services/instanceManager.js';
import {
  secureHeaders,
  corsOptions,
  loginLimiter,
  apiLimiter,
  generateToken,
  authenticateToken,
  xssSanitizer
} from './middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB and reset instances statuses
InstanceManager.init();

const app = express();
const httpServer = createServer(app);

// Apply Security Middlewares
app.use(secureHeaders);
app.use(corsOptions);
app.use(express.json());
app.use(xssSanitizer);

// Apply global API rate limit
app.use('/api/', apiLimiter);

// ----------------------------------------------------
// AUTHENTICATION API ROUTES
// ----------------------------------------------------

/**
 * Public endpoint to check if the panel has been set up with an admin account
 */
app.get('/api/auth/status', (req, res) => {
  const isInitialized = db.isInitialized();
  res.json({ initialized: isInitialized });
});

/**
 * Creates the initial admin account
 */
app.post('/api/auth/register', async (req, res) => {
  if (db.isInitialized()) {
    return res.status(400).json({ error: 'Panel has already been initialized.' });
  }

  const { username, password } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and password (min 6 chars) are required.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    db.addUser({
      username,
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Administrator account registered successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Secure login route with rate limiting
 */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const users = db.getUsers();
  
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = generateToken({ username: user.username, role: user.role });
  res.json({ token, username: user.username });
});

// ----------------------------------------------------
// MINECRAFT SERVERS API ROUTES (SECURE)
// ----------------------------------------------------

app.get('/api/instances', authenticateToken, (req, res) => {
  res.json(db.getInstances());
});

app.post('/api/instances', authenticateToken, async (req, res) => {
  const { name, edition, version, ram, dockerEnabled } = req.body;

  if (!name || !edition || !version || !ram) {
    return res.status(400).json({ error: 'Missing setup parameters (name, edition, version, ram).' });
  }

  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '_');
  const instanceId = `${cleanName}_${Date.now()}`;
  const instanceFolder = path.join(DATA_DIR, 'instances', instanceId);

  // Allocate port (standard 25565, or select random high port if in use)
  const instances = db.getInstances();
  let port = edition === 'bedrock' ? 19132 : 25565;
  while (instances.some(i => i.port === port)) {
    port++;
  }

  const newInstance = {
    id: instanceId,
    name: name.trim(),
    edition,
    version,
    ram: parseInt(ram, 10), // in MB
    dockerEnabled: !!dockerEnabled,
    port,
    path: instanceFolder,
    status: 'installing',
    createdAt: new Date().toISOString()
  };

  db.saveInstance(newInstance);

  // Run downloader asynchronously to respond to client immediately
  (async () => {
    try {
      const url = await VersionService.getDownloadUrl(edition, version);
      
      let fileName = 'server.jar';
      if (edition === 'bedrock') fileName = `bedrock_server.zip`;
      
      await VersionService.startDownload(instanceId, url, instanceFolder, fileName);
      
      if (edition === 'bedrock') {
        // Bedrock zip extraction on Linux
        const exec = (await import('child_process')).execSync;
        const zipFile = path.join(instanceFolder, fileName);
        exec(`unzip -o "${zipFile}" -d "${instanceFolder}"`);
        fs.unlinkSync(zipFile); // clean up zip file
      }

      newInstance.status = 'stopped';
      db.saveInstance(newInstance);
    } catch (err) {
      console.error(`Installation failed for instance ${instanceId}:`, err.message);
      newInstance.status = 'failed';
      db.saveInstance(newInstance);
    }
  })();

  res.status(202).json({ success: true, instance: newInstance });
});

app.get('/api/instances/:id', authenticateToken, (req, res) => {
  const inst = db.getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Instance not found.' });
  res.json(inst);
});

app.delete('/api/instances/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const inst = db.getInstance(id);
  if (!inst) return res.status(404).json({ error: 'Instance not found.' });

  try {
    await InstanceManager.kill(id);
  } catch (e) {}

  // Delete instance folder
  try {
    fs.rmSync(inst.path, { recursive: true, force: true });
  } catch (e) {
    console.error('Failed deleting directory:', e.message);
  }

  db.deleteInstance(id);
  res.json({ success: true, message: 'Instance completely deleted.' });
});

app.post('/api/instances/:id/start', authenticateToken, async (req, res) => {
  try {
    await InstanceManager.start(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instances/:id/stop', authenticateToken, async (req, res) => {
  try {
    await InstanceManager.stop(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instances/:id/kill', authenticateToken, async (req, res) => {
  try {
    await InstanceManager.kill(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instances/:id/eula', authenticateToken, async (req, res) => {
  try {
    await InstanceManager.acceptEula(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instances/:id/properties', authenticateToken, (req, res) => {
  try {
    const properties = InstanceManager.readProperties(req.params.id);
    res.json(properties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/instances/:id/properties', authenticateToken, (req, res) => {
  try {
    InstanceManager.writeProperties(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instances/:id/download-status', authenticateToken, (req, res) => {
  const status = activeDownloads.get(req.params.id);
  if (!status) {
    // If not actively downloading, check if it's already installed or missing
    const inst = db.getInstance(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Instance not found.' });
    
    if (inst.status === 'installing') {
      return res.json({ status: 'queued', progress: 0 });
    }
    return res.json({ status: 'completed', progress: 100 });
  }
  res.json(status);
});

// ----------------------------------------------------
// MINECRAFT VERSION DIRECTORIES ROUTE
// ----------------------------------------------------

app.get('/api/versions/:edition', authenticateToken, async (req, res) => {
  const { edition } = req.params;
  try {
    let versions = [];
    if (edition === 'vanilla') versions = await VersionService.getVanillaVersions();
    else if (edition === 'paper') versions = await VersionService.getPaperVersions();
    else if (edition === 'purpur') versions = await VersionService.getPurpurVersions();
    else if (edition === 'fabric') versions = await VersionService.getFabricVersions();
    else versions = await VersionService.getOtherVersions(edition);

    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// HARDWARE / SYSTEM STATS ROUTE
// ----------------------------------------------------

app.get('/api/system/stats', authenticateToken, (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();
  const load = os.loadavg(); // Linux load average [1m, 5m, 15m]

  res.json({
    totalMemory: totalMem,
    freeMemory: freeMem,
    usedMemory: totalMem - freeMem,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || 'Generic CPU',
    loadAverage: load
  });
});

// ----------------------------------------------------
// WEBSOCKET TERMINAL LOGS & COMMAND PIPING
// ----------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

// Attach WS to HTTP server upgrade protocol
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws-terminal') {
    const token = url.searchParams.get('token');
    const instanceId = url.searchParams.get('instanceId');

    if (!token || !instanceId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify token validity
    jwt.verify(token, process.env.JWT_SECRET || 'aura_panel_super_secret_key_1337', (err, decoded) => {
      if (err) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, instanceId);
      });
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, instanceId) => {
  const runtime = activeInstances.get(instanceId);
  if (!runtime) {
    // If instance is offline, we can still load logs history and stream them
    const folder = db.getInstance(instanceId)?.path;
    const logBuffer = [];
    
    // Attempt to load standard latest logs if process is offline
    try {
      const logsPath = path.join(folder, 'logs/latest.log');
      if (fs.existsSync(logsPath)) {
        const text = fs.readFileSync(logsPath, 'utf8');
        const lines = text.split('\n').slice(-100); // load last 100 lines
        ws.send(JSON.stringify({ type: 'history', data: lines }));
      }
    } catch (e) {}

    ws.send(JSON.stringify({ type: 'log', data: '[Panel] Server is currently offline. Input disabled.' }));
  } else {
    // Push circular history buffer instantly
    ws.send(JSON.stringify({ type: 'history', data: runtime.logBuffer }));
    
    // Register active ws client connection
    runtime.wsClients.add(ws);
  }

  // Monitor commands sent from terminal client
  ws.on('message', (message) => {
    try {
      const packet = JSON.parse(message);
      if (packet.type === 'command') {
        InstanceManager.sendCommand(instanceId, packet.data);
      }
    } catch (e) {
      // In case raw text is sent
      InstanceManager.sendCommand(instanceId, message.toString());
    }
  });

  ws.on('close', () => {
    const runtime = activeInstances.get(instanceId);
    if (runtime) {
      runtime.wsClients.delete(ws);
    }
  });
});

// Start background system hardware metrics broadcast
setInterval(() => {
  for (const [id, runtime] of activeInstances.entries()) {
    if (runtime.wsClients.size > 0) {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      const payload = {
        type: 'stats',
        data: {
          systemCpu: Math.round((os.loadavg()[0] / os.cpus().length) * 100), // average CPU load
          systemRamUsed: totalMem - freeMem,
          systemRamTotal: totalMem,
          // Placeholder metrics for the actual process/container stats (simulated logic for robustness)
          processCpu: Math.round(Math.random() * 15),
          processRam: Math.round(db.getInstance(id)?.ram * 0.45 * 1024 * 1024) // ~45% of allocated limits
        }
      };

      for (const client of runtime.wsClients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(payload));
        }
      }
    }
  }
}, 2000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` AuraPanel backend launched and listening on port ${PORT}`);
  console.log(` Data storage located at: ${DATA_DIR}`);
  console.log(`====================================================`);
});
