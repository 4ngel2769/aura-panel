import Docker from 'dockerode';
import fs from 'fs';

// Initialize Dockerode, targeting standard Unix socket
let docker;
try {
  docker = new Docker({ socketPath: '/var/run/docker.sock' });
} catch (e) {
  console.warn('Docker daemon not detected or unavailable at /var/run/docker.sock. Docker capabilities will be disabled.');
}

/**
 * Helper to determine best Java container image based on MC version
 */
export function getJavaDockerImage(edition, version) {
  if (edition === 'bedrock') {
    return 'ubuntu:22.04'; // Bedrock runs natively on Ubuntu
  }

  // Parse version major/minor, e.g. "1.20.4" -> 20
  const parts = version.split('.');
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  if (minor <= 11) {
    return 'eclipse-temurin:8-jre';
  }
  if (minor <= 16) {
    return 'eclipse-temurin:11-jre';
  }
  if (minor === 17) {
    return 'eclipse-temurin:16-jre';
  }
  if (minor <= 20) {
    // 1.20.5+ requires Java 21
    if (minor === 20 && patch >= 5) {
      return 'eclipse-temurin:21-jre';
    }
    return 'eclipse-temurin:17-jre';
  }
  return 'eclipse-temurin:21-jre'; // Default to newest JRE
}

export const DockerService = {
  isAvailable() {
    return !!docker;
  },

  /**
   * Asynchronously pull a Docker image if it doesn't exist locally
   */
  async pullImage(imageName) {
    if (!docker) throw new Error('Docker is not available on this host.');
    
    const localImages = await docker.listImages();
    const exists = localImages.some(img => img.RepoTags && img.RepoTags.includes(imageName));
    
    if (exists) return true;

    console.log(`Pulling Docker image: ${imageName}`);
    return new Promise((resolve, reject) => {
      docker.pull(imageName, (err, stream) => {
        if (err) return reject(err);
        
        docker.modem.followProgress(stream, (finishedErr, output) => {
          if (finishedErr) return reject(finishedErr);
          console.log(`Image pulled successfully: ${imageName}`);
          resolve(true);
        });
      });
    });
  },

  /**
   * Spawns a Minecraft instance inside a Docker container
   */
  async startContainer(instance, optimalFlags) {
    if (!docker) throw new Error('Docker is not available.');

    const imageName = getJavaDockerImage(instance.edition, instance.version);
    await this.pullImage(imageName);

    // Host directory containing server files
    const hostPath = instance.path;
    const containerWorkDir = '/data';

    // Build container configuration
    const portString = String(instance.port || 25565);
    
    // Command differs for Bedrock vs Java
    let cmd = [];
    if (instance.edition === 'bedrock') {
      // Bedrock: install dependencies on standard Ubuntu container and execute
      cmd = [
        '/bin/bash', '-c',
        'apt-get update && apt-get install -y libcurl4 && chmod +x ./bedrock_server && LD_LIBRARY_PATH=. ./bedrock_server'
      ];
    } else {
      // Java
      cmd = ['java', ...optimalFlags, '-jar', 'server.jar', 'nogui'];
    }

    const containerConfig = {
      Image: imageName,
      Cmd: cmd,
      name: `aura-mc-${instance.id}`,
      WorkingDir: containerWorkDir,
      ExposedPorts: {
        [`${portString}/tcp`]: {},
        [`${portString}/udp`]: {}
      },
      HostConfig: {
        Binds: [
          `${hostPath}:${containerWorkDir}`
        ],
        PortBindings: {
          [`${portString}/tcp`]: [{ HostPort: portString }],
          [`${portString}/udp`]: [{ HostPort: portString }]
        },
        Memory: instance.ram * 1024 * 1024, // RAM limit in bytes
        RestartPolicy: { Name: 'unless-stopped' }
      },
      Tty: true,
      OpenStdin: true,
      StdinOnce: false
    };

    // Remove existing container with the same name if it exists (e.g. leftover from a crash)
    try {
      const existing = docker.getContainer(`aura-mc-${instance.id}`);
      await existing.remove({ force: true });
    } catch (e) {
      // Container didn't exist, ignore
    }

    console.log(`Creating container for ${instance.name}...`);
    const container = await docker.createContainer(containerConfig);
    
    console.log(`Starting container for ${instance.name}...`);
    await container.start();

    return container;
  },

  /**
   * Stops and deletes a container
   */
  async stopContainer(instanceId) {
    if (!docker) return;
    try {
      const container = docker.getContainer(`aura-mc-${instanceId}`);
      await container.stop({ t: 10 }); // 10s timeout
      await container.remove();
    } catch (e) {
      console.warn(`Failed to stop/remove container aura-mc-${instanceId}:`, e.message);
    }
  },

  /**
   * Force kills a container
   */
  async killContainer(instanceId) {
    if (!docker) return;
    try {
      const container = docker.getContainer(`aura-mc-${instanceId}`);
      await container.kill();
      await container.remove();
    } catch (e) {
      console.warn(`Failed to kill container aura-mc-${instanceId}:`, e.message);
    }
  }
};
