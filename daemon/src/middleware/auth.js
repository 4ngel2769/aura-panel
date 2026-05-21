import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

// Loaded config memory cache
let daemonKey = '';

export function getDaemonKey() {
  if (daemonKey) return daemonKey;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      daemonKey = data.key;
      return daemonKey;
    }
  } catch (e) {
    console.error('Failed reading daemon key from config:', e.message);
  }
  return '';
}

/**
 * Express Middleware validating incoming X-Daemon-Key header
 */
export function authenticateDaemonKey(req, res, next) {
  const headerKey = req.headers['x-daemon-key'];
  const localKey = getDaemonKey();

  if (!headerKey || headerKey !== localKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing Daemon authentication key.' });
  }

  next();
}
