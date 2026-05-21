import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store files in daemon/data
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultStructure = {
  instances: []
};

class DaemonDatabase {
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
      console.warn('Error reading daemon database, resetting:', e.message);
      this.data = { ...defaultStructure };
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed saving daemon DB:', e.message);
    }
  }

  getInstances() {
    return this.data.instances || [];
  }

  getInstance(id) {
    return this.data.instances.find(inst => inst.id === id);
  }

  saveInstance(instance) {
    const index = this.data.instances.findIndex(inst => inst.id === instance.id);
    if (index !== -1) {
      this.data.instances[index] = { ...this.data.instances[index], ...instance };
    } else {
      this.data.instances.push(instance);
    }
    this.save();
  }

  deleteInstance(id) {
    this.data.instances = this.data.instances.filter(inst => inst.id !== id);
    this.save();
  }
}

const db = new DaemonDatabase();
export default db;
export { DATA_DIR };
