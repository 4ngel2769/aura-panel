import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

import db, { DATA_DIR } from './services/db.js';
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

const app = express();
const httpServer = createServer(app);

// Apply Security Middlewares
app.use(secureHeaders);
app.use(corsOptions);
app.use(express.json());
app.use(xssSanitizer);

// Apply global API rate limit
app.use('/api/', apiLimiter);

// Multer upload config on panel to capture temp files before forwarding
const tempDir = path.join(DATA_DIR, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
const upload = multer({ dest: tempDir });

// ----------------------------------------------------
// AUTHENTICATION API ROUTES
// ----------------------------------------------------

app.get('/api/auth/status', (req, res) => {
  res.json({ initialized: db.isInitialized() });
});

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

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const users = db.getUsers();
  
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

  const token = generateToken({ username: user.username, role: user.role });
  res.json({ token, username: user.username });
});

// ----------------------------------------------------
// DAEMONS (REMOTE NODES) DIRECT API
// ----------------------------------------------------

app.get('/api/daemons', authenticateToken, (req, res) => {
  // Return list of nodes (without keys for security!)
  const daemons = db.getDaemons().map(({ key, ...d }) => d);
  res.json(daemons);
});

app.post('/api/daemons', authenticateToken, async (req, res) => {
  const { name, ip, port, key } = req.body;

  if (!name || !ip || !port || !key) {
    return res.status(400).json({ error: 'Missing daemon configuration fields.' });
  }

  const daemonId = `node_${Date.now()}`;
  const newDaemon = {
    id: daemonId,
    name: name.trim(),
    ip: ip.trim(),
    port: parseInt(port, 10),
    key: key.trim(),
    createdAt: new Date().toISOString()
  };

  db.saveDaemon(newDaemon);
  res.json({ success: true, daemon: { id: daemonId, name: newDaemon.name, ip: newDaemon.ip, port: newDaemon.port } });
});

app.delete('/api/daemons/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const daemon = db.getDaemon(id);
  if (!daemon) return res.status(404).json({ error: 'Daemon not found.' });

  db.deleteDaemon(id);
  res.json({ success: true });
});

app.post('/api/daemons/:id/test-connection', authenticateToken, async (req, res) => {
  const daemon = db.getDaemon(req.params.id);
  if (!daemon) return res.status(404).json({ error: 'Daemon not found.' });

  try {
    const response = await axios.get(`http://${daemon.ip}:${daemon.port}/api/system/stats`, {
      headers: { 'X-Daemon-Key': daemon.key },
      timeout: 3000
    });
    res.json({ success: true, stats: response.data });
  } catch (error) {
    res.json({ success: false, error: `Connection failed: ${error.message}` });
  }
});

// ----------------------------------------------------
// HTTP PROXY SERVICE TO DAEMON NODES
// ----------------------------------------------------

// Custom file upload proxy handler
app.post('/api/proxy/daemons/:daemonId/files/upload', authenticateToken, upload.single('file'), async (req, res) => {
  const { daemonId } = req.params;
  const daemon = db.getDaemon(daemonId);
  if (!daemon) return res.status(404).json({ error: 'Daemon not found.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', fs.createReadStream(req.file.path), req.file.originalname);

  try {
    const response = await axios.post(`http://${daemon.ip}:${daemon.port}/api/files/upload`, form, {
      headers: {
        ...form.getHeaders(),
        'X-Daemon-Key': daemon.key
      },
      params: req.query,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    // clean local temp file
    fs.unlinkSync(req.file.path);
    res.json(response.data);
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(e.response?.status || 500).json({ error: e.response?.data?.error || e.message });
  }
});

// Wildcard HTTP proxy catching all requests
app.all('/api/proxy/daemons/:daemonId/*', authenticateToken, async (req, res) => {
  const { daemonId } = req.params;
  const daemon = db.getDaemon(daemonId);
  if (!daemon) return res.status(404).json({ error: 'Daemon not found.' });

  // Get the suffix route
  const suffix = req.params[0];
  const targetUrl = `http://${daemon.ip}:${daemon.port}/api/${suffix}`;

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        'X-Daemon-Key': daemon.key,
        'Content-Type': 'application/json'
      },
      params: req.query,
      data: req.body,
      timeout: 30000
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.error || err.message;
    res.status(status).json({ error: msg });
  }
});

// ----------------------------------------------------
// WEBSOCKET TERMINAL PROXY RELAY
// ----------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/proxy/ws-terminal') {
    const token = url.searchParams.get('token');
    const daemonId = url.searchParams.get('daemonId');
    const instanceId = url.searchParams.get('instanceId');

    if (!token || !daemonId || !instanceId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    jwt.verify(token, process.env.JWT_SECRET || 'aura_panel_super_secret_key_1337', (err, decoded) => {
      if (err) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, daemonId, instanceId);
      });
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, daemonId, instanceId) => {
  const daemon = db.getDaemon(daemonId);
  if (!daemon) {
    ws.send(JSON.stringify({ type: 'log', data: '[Panel Proxy Error] Daemon not found.' }));
    ws.close();
    return;
  }

  // Connect client websocket directly to remote daemon agent
  const daemonWsUrl = `ws://${daemon.ip}:${daemon.port}/api/ws?key=${daemon.key}&instanceId=${instanceId}`;
  const daemonSocket = new WebSocket(daemonWsUrl);

  daemonSocket.on('open', () => {
    // Pipe messages bidirectionally
    ws.on('message', (message) => {
      if (daemonSocket.readyState === WebSocket.OPEN) {
        daemonSocket.send(message.toString());
      }
    });

    daemonSocket.on('message', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString());
      }
    });
  });

  daemonSocket.on('error', (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', data: `[Panel Proxy Error] Failed to connect to remote node WebSocket: ${err.message}` }));
    }
  });

  daemonSocket.on('close', () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on('close', () => {
    if (daemonSocket.readyState === WebSocket.OPEN) daemonSocket.close();
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` AuraPanel Web Proxy started on port ${PORT}`);
  console.log(` Local Storage directories initialized.`);
  console.log(`====================================================`);
});
