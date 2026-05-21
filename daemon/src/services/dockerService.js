import Docker from 'dockerode';
import fs from 'fs';

let docker;
try {
  docker = new Docker({ socketPath: '/var/run/docker.sock' });
} catch (e) {
  console.warn('Docker daemon not detected or unavailable at /var/run/docker.sock. Docker capabilities will be disabled.');
}

export function getJavaDockerImage(edition, version) {
  if (edition === 'bedrock') {
    return 'ubuntu:22.04';
  }

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
    if (minor === 20 && patch >= 5) {
      return 'eclipse-temurin:21-jre';
    }
    return 'eclipse-temurin:17-jre';
  }
  return 'eclipse-temurin:21-jre';
}

export const DockerService = {
  isAvailable() {
    return !!docker;
  },

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

  async startContainer(instance, optimalFlags) {
    if (!docker) throw new Error('Docker is not available.');

    const imageName = getJavaDockerImage(instance.edition, instance.version);
    await this.pullImage(imageName);

    const hostPath = instance.path;
    const containerWorkDir = '/data';

    const portString = String(instance.port || 25565);
    
    let cmd = [];
    if (instance.edition === 'bedrock') {
      cmd = [
        '/bin/bash', '-c',
        'apt-get update && apt-get install -y libcurl4 && chmod +x ./bedrock_server && LD_LIBRARY_PATH=. ./bedrock_server'
      ];
    } else {
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
        Memory: instance.ram * 1024 * 1024,
        RestartPolicy: { Name: 'unless-stopped' }
      },
      Tty: true,
      OpenStdin: true,
      StdinOnce: false
    };

    try {
      const existing = docker.getContainer(`aura-mc-${instance.id}`);
      await existing.remove({ force: true });
    } catch (e) {
      // ignore
    }

    console.log(`Creating container for ${instance.name}...`);
    const container = await docker.createContainer(containerConfig);
    
    console.log(`Starting container for ${instance.name}...`);
    await container.start();

    return container;
  },

  async stopContainer(instanceId) {
    if (!docker) return;
    try {
      const container = docker.getContainer(`aura-mc-${instanceId}`);
      await container.stop({ t: 10 });
      await container.remove();
    } catch (e) {
      console.warn(`Failed to stop/remove container aura-mc-${instanceId}:`, e.message);
    }
  },

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
