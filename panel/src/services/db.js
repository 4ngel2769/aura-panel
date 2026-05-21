import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data files stored in panel/data
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultStructure = {
  users: [],
  daemons: [], // list of registered remote nodes { id, name, ip, port, key, createdAt }
};

class PanelDatabase {
  constructor() {
    this.data = { ...defaultStructure };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('Failed reading panel DB, initializing fresh:', e.message);
      this.data = { ...defaultStructure };
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed saving panel DB:', e.message);
    }
  }

  getUsers() {
    return this.data.users || [];
  }

  addUser(user) {
    this.data.users.push(user);
    this.save();
  }

  getDaemons() {
    return this.data.daemons || [];
  }

  getDaemon(id) {
    return this.data.daemons.find(d => d.id === id);
  }

  saveDaemon(daemon) {
    const idx = this.data.daemons.findIndex(d => d.id === daemon.id);
    if (idx !== -1) {
      this.data.daemons[idx] = { ...this.data.daemons[idx], ...daemon };
    } else {
      this.data.daemons.push(daemon);
    }
    this.save();
  }

  deleteDaemon(id) {
    this.data.daemons = this.data.daemons.filter(d => d.id !== id);
    this.save();
  }

  isInitialized() {
    return this.getUsers().length > 0;
  }
}

const db = new PanelDatabase();
export default db;
export { DATA_DIR };
