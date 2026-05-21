import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import db, { DATA_DIR } from './db.js';
import { DockerService } from './dockerService.js';

// Global memory cache to track running server entities
// Structure: instanceId -> { process, container, logBuffer: [], wsClients: Set }
export const activeInstances = new Map();

// Standard Aikar's JVM flags optimized for Minecraft performance
const AIKAR_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8m',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapFraction=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1'
];

/**
 * Compiles a list of optimal JVM flags depending on edition and RAM
 */
export function compileJVMFlags(edition, ramInMB) {
  const isMB = ramInMB < 1024;
  const sizeString = isMB ? `${ramInMB}M` : `${Math.round(ramInMB / 1024)}G`;
  
  const baseFlags = [`-Xms${sizeString}`, `-Xmx${sizeString}`];

  // Aikar's flags are optimized for Paper/Purpur/Spigot setups allocating >= 2GB
  if (['paper', 'purpur', 'spigot'].includes(edition) && ramInMB >= 2048) {
    return [...baseFlags, ...AIKAR_FLAGS];
  }

  // Fallback default garbage collection optimization flags
  return [...baseFlags, '-XX:+UseG1GC', '-XX:+AlwaysPreTouch'];
}

export const InstanceManager = {
  /**
   * Initializes instance structures on backend startup
   * Ensures offline/stopped state for all instances in database
   */
  init() {
    const instances = db.getInstances();
    for (const inst of instances) {
      if (inst.status !== 'stopped') {
        inst.status = 'stopped';
        db.saveInstance(inst);
      }
    }
  },

  /**
   * Spawns/Runs a Minecraft server instance
   */
  async start(id) {
    const inst = db.getInstance(id);
    if (!inst) throw new Error('Instance not found');

    if (activeInstances.has(id)) {
      throw new Error('Instance is already running or launching');
    }

    // Set initial status to starting
    inst.status = 'starting';
    db.saveInstance(inst);

    const logBuffer = [];
    const wsClients = new Set();
    
    activeInstances.set(id, {
      process: null,
      container: null,
      logBuffer,
      wsClients,
    });

    const logToBuffer = (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logBuffer.push(line);
          if (logBuffer.length > 1000) logBuffer.shift(); // circular buffer limits
          
          // Broadcast to connected web socket admin clients
          for (const client of wsClients) {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'log', data: line }));
            }
          }
        }
      }

      // Proactively detect EULA errors
      if (text.includes('Failed to load eula.txt') || text.includes('You need to agree to the EULA')) {
        this.handleEulaRequirement(id);
      }
    };

    const optimalFlags = compileJVMFlags(inst.edition, inst.ram);

    try {
      if (inst.dockerEnabled) {
        // Run using Dockerode
        if (!DockerService.isAvailable()) {
          throw new Error('Docker is not enabled or available on this system.');
        }

        logToBuffer(`[Panel] Launching ${inst.name} in a Docker container...`);
        const container = await DockerService.startContainer(inst, optimalFlags);
        
        const runtimeState = activeInstances.get(id);
        if (runtimeState) {
          runtimeState.container = container;
        }

        inst.status = 'running';
        db.saveInstance(inst);
        logToBuffer('[Panel] Container started successfully.');

        // Stream Docker logs in background
        container.logs({
          follow: true,
          stdout: true,
          stderr: true,
          timestamps: false
        }, (err, stream) => {
          if (err) return logToBuffer(`[Docker Error] ${err.message}`);
          
          if (stream) {
            container.modem.demuxStream(stream, {
              write: (chunk) => logToBuffer(chunk.toString()),
            }, {
              write: (chunk) => logToBuffer(chunk.toString()),
            });
          }
        });

      } else {
        // Run natively as a subprocess
        logToBuffer(`[Panel] Launching ${inst.name} natively on host...`);
        
        let spawnCommand = 'java';
        let spawnArgs = [...optimalFlags, '-jar', 'server.jar', 'nogui'];
        
        if (inst.edition === 'bedrock') {
          spawnCommand = './bedrock_server';
          spawnArgs = [];
        }

        // Run with env vars
        const env = { ...process.env };
        if (inst.edition === 'bedrock') {
          env.LD_LIBRARY_PATH = '.';
        }

        const child = spawn(spawnCommand, spawnArgs, {
          cwd: inst.path,
          env,
          shell: inst.edition === 'bedrock' // bedrock binary spawn on Unix shell
        });

        const runtimeState = activeInstances.get(id);
        if (runtimeState) {
          runtimeState.process = child;
        }

        inst.status = 'running';
        db.saveInstance(inst);

        child.stdout.on('data', logToBuffer);
        child.stderr.on('data', logToBuffer);

        child.on('close', (code) => {
          logToBuffer(`[Panel] Server process exited with code ${code}`);
          this.handleTermination(id);
        });

        child.on('error', (err) => {
          logToBuffer(`[Panel Error] Spawn failed: ${err.message}`);
          this.handleTermination(id);
        });
      }
    } catch (err) {
      logToBuffer(`[Panel Launch Failure] ${err.message}`);
      this.handleTermination(id);
      throw err;
    }
  },

  /**
   * Stops an instance cleanly using command injection or Docker signals
   */
  async stop(id) {
    const inst = db.getInstance(id);
    const runtime = activeInstances.get(id);
    
    if (!inst) throw new Error('Instance not found');

    inst.status = 'stopping';
    db.saveInstance(inst);

    if (runtime) {
      this.sendCommand(id, 'stop');
      this.sendCommand(id, 'end'); // bedrock stop equivalent

      // Wait a few seconds for process to exit, then kill if stubborn
      setTimeout(async () => {
        const check = db.getInstance(id);
        if (check && check.status === 'stopping') {
          await this.kill(id);
        }
      }, 10000);
    } else {
      this.handleTermination(id);
    }
  },

  /**
   * Forces process kill or container removal
   */
  async kill(id) {
    const inst = db.getInstance(id);
    const runtime = activeInstances.get(id);

    if (inst) {
      inst.status = 'stopping';
      db.saveInstance(inst);
    }

    if (runtime) {
      if (runtime.process) {
        runtime.process.kill('SIGKILL');
      }
      if (runtime.container) {
        await DockerService.killContainer(id);
      }
    }
    
    this.handleTermination(id);
  },

  /**
   * Inject CLI command directly to server console
   */
  sendCommand(id, cmd) {
    const runtime = activeInstances.get(id);
    if (!runtime) return false;

    const formattedCmd = `${cmd}\n`;
    if (runtime.process && runtime.process.stdin.writable) {
      runtime.process.stdin.write(formattedCmd);
      return true;
    }

    if (runtime.container) {
      // Inject stdin into running container
      try {
        const stream = runtime.container.attach({
          stream: true,
          stdin: true,
          stdout: false,
          stderr: false
        }, (err, attachedStream) => {
          if (!err && attachedStream) {
            attachedStream.write(formattedCmd);
            attachedStream.end();
          }
        });
        return true;
      } catch (e) {
        console.error(`Failed to inject stdin to container for instance ${id}:`, e.message);
      }
    }
    return false;
  },

  /**
   * Mark database structure and free memory handles when instance halts
   */
  handleTermination(id) {
    const inst = db.getInstance(id);
    if (inst && inst.status !== 'need_eula') {
      inst.status = 'stopped';
      db.saveInstance(inst);
    }

    const runtime = activeInstances.get(id);
    if (runtime) {
      // Disconnect all listeners but preserve log buffer until started again
      activeInstances.delete(id);
    }
  },

  /**
   * Handle case where Minecraft server terminates because EULA is not agreed to
   */
  handleEulaRequirement(id) {
    const inst = db.getInstance(id);
    if (inst) {
      inst.status = 'need_eula';
      db.saveInstance(inst);
    }
  },

  /**
   * Edits/Agrees to Minecraft standard eula.txt
   */
  async acceptEula(id) {
    const inst = db.getInstance(id);
    if (!inst) throw new Error('Instance not found');

    const eulaFile = path.join(inst.path, 'eula.txt');
    
    // Explicitly write eula=true inside eula.txt file
    fs.writeFileSync(eulaFile, '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/mc-eula).\neula=true\n', 'utf8');
    
    // Set status to stopped and run again
    inst.status = 'stopped';
    db.saveInstance(inst);

    await this.start(id);
  },

  /**
   * Parses server.properties key value map
   */
  readProperties(id) {
    const inst = db.getInstance(id);
    if (!inst) throw new Error('Instance not found');

    const propFile = path.join(inst.path, 'server.properties');
    if (!fs.existsSync(propFile)) {
      return {};
    }

    const content = fs.readFileSync(propFile, 'utf8');
    const lines = content.split('\n');
    const properties = {};

    for (const line of lines) {
      const clean = line.trim();
      if (clean && !clean.startsWith('#')) {
        const splitIdx = clean.indexOf('=');
        if (splitIdx !== -1) {
          const key = clean.substring(0, splitIdx).trim();
          const val = clean.substring(splitIdx + 1).trim();
          properties[key] = val;
        }
      }
    }

    return properties;
  },

  /**
   * Saves updated server.properties config
   */
  writeProperties(id, properties) {
    const inst = db.getInstance(id);
    if (!inst) throw new Error('Instance not found');

    const propFile = path.join(inst.path, 'server.properties');
    
    let content = '#Minecraft server properties\n#Generated & Managed by AuraPanel\n';
    for (const [key, val] of Object.entries(properties)) {
      content += `${key}=${val}\n`;
    }

    fs.writeFileSync(propFile, content, 'utf8');
    return true;
  }
};
