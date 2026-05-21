import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data stored in mc-panel-gravity/data directory on the host
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial structure
const defaultData = {
  users: [],
  instances: [],
  settings: {
    initialized: false
  }
};

class Database {
  constructor() {
    this.data = { ...defaultData };
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
    } catch (error) {
      console.error('Failed to load database. Initializing fresh template.', error);
      this.data = { ...defaultData };
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to write database file:', error);
    }
  }

  // User Actions
  getUsers() {
    return this.data.users || [];
  }

  addUser(user) {
    this.data.users.push(user);
    this.save();
  }

  // Instance Actions
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

  // System Settings
  isInitialized() {
    return this.getUsers().length > 0;
  }
}

const db = new Database();
export default db;
export { DATA_DIR };
