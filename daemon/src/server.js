import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { fileURLToPath } from 'url';

import db, { DATA_DIR } from './services/db.js';
import { FileManager } from './services/fileManager.js';
import { authenticateDaemonKey, getDaemonKey } from './middleware/auth.js';
import { VersionService, activeDownloads } from './services/versionService.js';
import { DockerService } from './services/dockerService.js';
import { InstanceManager, activeInstances } from './services/instanceManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(__dirname, '../config.json');

// Initialize database instance stats
InstanceManager.init();

// ----------------------------------------------------
// DAEMON CONFIG LOAD / GENERATE
// ----------------------------------------------------
let config = {
  name: 'AuraNode-Primary',
  address: '0.0.0.0',
  port: 21013,
  key: ''
};

if (fs.existsSync(CONFIG_PATH)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) {
    console.error('Failed to parse config.json, writing defaults.');
  }
}

if (!config.key) {
  // Generate random 32-char hex authentication token
  config.key = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

const app = express();
const httpServer = createServer(app);

app.use(cors()); // Allow central web panel connections
app.use(express.json());

// Apply Daemon Auth to all API endpoints
app.use('/api/', authenticateDaemonKey);

// Multer configured for zip uploads
const uploadDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// ----------------------------------------------------
// DAEMON FILE BROWSER ENDPOINTS
// ----------------------------------------------------

app.get('/api/files/list', (req, res) => {
  const { path: queryPath } = req.query;
  if (!queryPath) return res.status(400).json({ error: 'Missing path query parameter.' });

  try {
    const list = FileManager.listDirectory(queryPath);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/read', (req, res) => {
  const { path: queryPath } = req.query;
  if (!queryPath) return res.status(400).json({ error: 'Missing path query parameter.' });

  try {
    const content = FileManager.readFile(queryPath);
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/write', (req, res) => {
  const { path: queryPath, content } = req.body;
  if (!queryPath || content === undefined) {
    return res.status(400).json({ error: 'Missing parameters (path, content).' });
  }

  try {
    FileManager.writeFile(queryPath, content);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/mkdir', (req, res) => {
  const { path: queryPath } = req.body;
  if (!queryPath) return res.status(400).json({ error: 'Missing path parameter.' });

  try {
    FileManager.createDirectory(queryPath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/delete', (req, res) => {
  const { path: queryPath } = req.body;
  if (!queryPath) return res.status(400).json({ error: 'Missing path parameter.' });

  try {
    FileManager.deletePath(queryPath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/unzip', (req, res) => {
  const { zipPath, targetDir } = req.body;
  if (!zipPath || !targetDir) {
    return res.status(400).json({ error: 'Missing parameters (zipPath, targetDir).' });
  }

  try {
    FileManager.unzipArchive(zipPath, targetDir);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  
  const { targetPath } = req.query;
  if (targetPath) {
    try {
      const dest = path.resolve(targetPath);
      const parent = path.dirname(dest);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.copyFileSync(req.file.path, dest);
      fs.unlinkSync(req.file.path);
      return res.json({
        success: true,
        fileName: req.file.originalname,
        filePath: dest
      });
    } catch (e) {
      if (fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (err) {}
      }
      return res.status(500).json({ error: `Failed to write file to target path: ${e.message}` });
    }
  }

  res.json({
    success: true,
    fileName: req.file.filename,
    filePath: req.file.path
  });
});

// ----------------------------------------------------
// DAEMON INSTANCES MANAGEMENT ENDPOINTS
// ----------------------------------------------------

app.get('/api/instances', (req, res) => {
  res.json(db.getInstances());
});

app.post('/api/instances', async (req, res) => {
  const { id, name, edition, version, ram, dockerEnabled, path: customPath, linkExisting, zipPath, port: customPort } = req.body;

  if (!name || !edition || !version || !ram) {
    return res.status(400).json({ error: 'Missing parameters.' });
  }

  // Determine paths: default /home/aura/servers/<id>
  const cleanId = id || `aura_${Date.now()}`;
  const resolvedFolder = customPath || `/home/aura/servers/${cleanId}`;

  // Prevent port collisions
  const instances = db.getInstances();
  let finalPort = customPort ? parseInt(customPort, 10) : (edition === 'bedrock' ? 19132 : 25565);
  while (instances.some(i => i.port === finalPort)) {
    finalPort++;
  }

  const newInstance = {
    id: cleanId,
    name,
    edition,
    version,
    ram: parseInt(ram, 10),
    dockerEnabled: !!dockerEnabled,
    port: finalPort,
    path: resolvedFolder,
    status: linkExisting ? 'stopped' : 'installing',
    createdAt: new Date().toISOString()
  };

  db.saveInstance(newInstance);

  // Download core jar or extract uploaded ZIP asynchronously
  if (!linkExisting) {
    (async () => {
      try {
        if (zipPath && fs.existsSync(zipPath)) {
          // Extracted Zip path
          console.log(`Extracting uploaded server template ${zipPath} into ${resolvedFolder}...`);
          FileManager.unzipArchive(zipPath, resolvedFolder);
          // Delete temp upload file
          fs.unlinkSync(zipPath);
          
          newInstance.status = 'stopped';
          db.saveInstance(newInstance);
        } else {
          // Fresh Core Download manifest
          const url = await VersionService.getDownloadUrl(edition, version);
          let fileName = 'server.jar';
          if (edition === 'bedrock') fileName = 'bedrock_server.zip';

          await VersionService.startDownload(cleanId, url, resolvedFolder, fileName);

          if (edition === 'bedrock') {
            const exec = (await import('child_process')).execSync;
            const zipFile = path.join(resolvedFolder, fileName);
            exec(`unzip -o "${zipFile}" -d "${resolvedFolder}"`);
            fs.unlinkSync(zipFile);
          }

          newInstance.status = 'stopped';
          db.saveInstance(newInstance);
        }
      } catch (err) {
        console.error(`Core build failed for ${cleanId}:`, err.message);
        newInstance.status = 'failed';
        db.saveInstance(newInstance);
      }
    })();
  }

  res.status(202).json({ success: true, instance: newInstance });
});

app.delete('/api/instances/:id', async (req, res) => {
  const { id } = req.params;
  const { deleteFiles } = req.body; // option to delete directory
  const inst = db.getInstance(id);

  if (!inst) return res.status(404).json({ error: 'Instance not found.' });

  try {
    await InstanceManager.kill(id);
  } catch (e) {}

  if (deleteFiles && fs.existsSync(inst.path)) {
    try {
      fs.rmSync(inst.path, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to wipe directories:', e.message);
    }
  }

  db.deleteInstance(id);
  res.json({ success: true });
});

app.post('/api/instances/:id/start', async (req, res) => {
  try {
    await InstanceManager.start(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/:id/stop', async (req, res) => {
  try {
    await InstanceManager.stop(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/:id/kill', async (req, res) => {
  try {
    await InstanceManager.kill(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/:id/eula', async (req, res) => {
  try {
    await InstanceManager.acceptEula(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/instances/:id/properties', (req, res) => {
  try {
    res.json(InstanceManager.readProperties(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/instances/:id/properties', (req, res) => {
  try {
    InstanceManager.writeProperties(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/instances/:id/download-status', (req, res) => {
  const status = activeDownloads.get(req.params.id);
  if (!status) {
    const inst = db.getInstance(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Instance not found.' });
    if (inst.status === 'installing') return res.json({ status: 'queued', progress: 0 });
    return res.json({ status: 'completed', progress: 100 });
  }
  res.json(status);
});

app.get('/api/versions/:edition', async (req, res) => {
  const { edition } = req.params;
  try {
    let versions = [];
    if (edition === 'vanilla') versions = await VersionService.getVanillaVersions();
    else if (edition === 'paper') versions = await VersionService.getPaperVersions();
    else if (edition === 'purpur') versions = await VersionService.getPurpurVersions();
    else if (edition === 'fabric') versions = await VersionService.getFabricVersions();
    else versions = await VersionService.getOtherVersions(edition);
    res.json(versions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/system/stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();
  res.json({
    totalMemory: totalMem,
    freeMemory: freeMem,
    usedMemory: totalMem - freeMem,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || 'Generic CPU',
    loadAverage: os.loadavg()
  });
});

// ----------------------------------------------------
// DAEMON WEBSOCKET UPGRADE CONNECTIONS
// ----------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/ws') {
    const key = url.searchParams.get('key');
    const instanceId = url.searchParams.get('instanceId');

    if (!key || key !== getDaemonKey() || !instanceId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, instanceId);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, instanceId) => {
  const runtime = activeInstances.get(instanceId);
  if (!runtime) {
    const folder = db.getInstance(instanceId)?.path;
    try {
      const logsPath = path.join(folder, 'logs/latest.log');
      if (fs.existsSync(logsPath)) {
        const text = fs.readFileSync(logsPath, 'utf8');
        const lines = text.split('\n').slice(-100);
        ws.send(JSON.stringify({ type: 'history', data: lines }));
      }
    } catch (e) {}
    ws.send(JSON.stringify({ type: 'log', data: '[Panel] Server is offline.' }));
  } else {
    ws.send(JSON.stringify({ type: 'history', data: runtime.logBuffer }));
    runtime.wsClients.add(ws);
  }

  ws.on('message', (message) => {
    InstanceManager.sendCommand(instanceId, message.toString());
  });

  ws.on('close', () => {
    const runtime = activeInstances.get(instanceId);
    if (runtime) runtime.wsClients.delete(ws);
  });
});

// Stream runtime stats to clients
setInterval(() => {
  for (const [id, runtime] of activeInstances.entries()) {
    if (runtime.wsClients.size > 0) {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      const payload = {
        type: 'stats',
        data: {
          systemCpu: Math.round((os.loadavg()[0] / os.cpus().length) * 100),
          systemRamUsed: totalMem - freeMem,
          systemRamTotal: totalMem,
          processCpu: Math.round(Math.random() * 15),
          processRam: Math.round(db.getInstance(id)?.ram * 0.45 * 1024 * 1024)
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

httpServer.listen(config.port, config.address, () => {
  console.log(`====================================================`);
  console.log(` AuraDaemon Agent is running on port ${config.port}`);
  console.log(` Listen Address: ${config.address}`);
  console.log(`====================================================`);
  console.log(` CRITICAL SECURITY KEY: ${config.key}`);
  console.log(` Copy and paste this key into your AuraPanel dashboard.`);
  console.log(`====================================================`);
});
