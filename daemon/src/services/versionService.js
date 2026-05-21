import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { DATA_DIR } from './db.js';

const cache = {
  vanilla: null,
  paper: null,
  purpur: null,
  fabric: null,
  bedrock: null,
  timestamp: 0,
};

const CACHE_TTL = 10 * 60 * 1000;

export const activeDownloads = new Map();

export const VersionService = {
  async getVanillaVersions() {
    if (cache.vanilla && Date.now() - cache.timestamp < CACHE_TTL) {
      return cache.vanilla;
    }
    try {
      const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const data = response.data;
      
      const versions = data.versions.map(v => ({
        id: v.id,
        type: v.type,
        url: v.url,
        releaseTime: v.releaseTime,
      }));

      cache.vanilla = versions;
      cache.timestamp = Date.now();
      return versions;
    } catch (error) {
      console.error('Failed fetching Vanilla versions:', error.message);
      return cache.vanilla || [];
    }
  },

  async getPaperVersions() {
    if (cache.paper && Date.now() - cache.timestamp < CACHE_TTL) {
      return cache.paper;
    }
    try {
      const response = await axios.get('https://api.papermc.io/v2/projects/paper');
      const data = response.data;
      
      const versions = [...data.versions].reverse().map(v => ({
        id: v,
        type: 'release',
        releaseTime: new Date().toISOString()
      }));

      cache.paper = versions;
      return versions;
    } catch (error) {
      console.error('Failed fetching Paper versions:', error.message);
      return cache.paper || [];
    }
  },

  async getPurpurVersions() {
    if (cache.purpur && Date.now() - cache.timestamp < CACHE_TTL) {
      return cache.purpur;
    }
    try {
      const response = await axios.get('https://api.purpurmc.org/v2/purpur');
      const data = response.data;
      
      const versions = [...data.versions].reverse().map(v => ({
        id: v,
        type: 'release',
        releaseTime: new Date().toISOString()
      }));

      cache.purpur = versions;
      return versions;
    } catch (error) {
      console.error('Failed fetching Purpur versions:', error.message);
      return cache.purpur || [];
    }
  },

  async getFabricVersions() {
    if (cache.fabric && Date.now() - cache.timestamp < CACHE_TTL) {
      return cache.fabric;
    }
    try {
      const response = await axios.get('https://meta.fabricmc.net/v2/versions/game');
      const data = response.data;
      
      const versions = data
        .filter(v => v.stable)
        .map(v => ({
          id: v.version,
          type: 'release',
          releaseTime: new Date().toISOString()
        }));

      cache.fabric = versions;
      return versions;
    } catch (error) {
      console.error('Failed fetching Fabric game versions:', error.message);
      return cache.fabric || [];
    }
  },

  async getOtherVersions(edition) {
    if (edition === 'bedrock') {
      return [
        { id: '1.21.0.03', type: 'release', downloadUrl: 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.21.0.03.zip' },
        { id: '1.20.81.01', type: 'release', downloadUrl: 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.20.81.01.zip' },
        { id: '1.20.73.01', type: 'release', downloadUrl: 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.20.73.01.zip' }
      ];
    }
    if (edition === 'forge') {
      return [
        { id: '1.20.4 (49.0.38)', type: 'release', mcVersion: '1.20.4', forgeVersion: '49.0.38' },
        { id: '1.20.1 (47.2.0)', type: 'release', mcVersion: '1.20.1', forgeVersion: '47.2.0' },
        { id: '1.19.2 (43.2.0)', type: 'release', mcVersion: '1.19.2', forgeVersion: '43.2.0' },
        { id: '1.18.2 (40.2.0)', type: 'release', mcVersion: '1.18.2', forgeVersion: '40.2.0' },
        { id: '1.16.5 (36.2.39)', type: 'release', mcVersion: '1.16.5', forgeVersion: '36.2.39' },
        { id: '1.12.2 (14.23.5.2860)', type: 'release', mcVersion: '1.12.2', forgeVersion: '14.23.5.2860' }
      ];
    }
    if (edition === 'neoforge') {
      return [
        { id: '20.4.237', type: 'release', neoforgeVersion: '20.4.237' },
        { id: '20.4.80', type: 'release', neoforgeVersion: '20.4.80' },
        { id: '20.2.86', type: 'release', neoforgeVersion: '20.2.86' }
      ];
    }
    if (edition === 'spigot') {
      return [
        { id: '1.21', type: 'release' },
        { id: '1.20.4', type: 'release' },
        { id: '1.20.1', type: 'release' },
        { id: '1.19.2', type: 'release' },
        { id: '1.18.2', type: 'release' },
        { id: '1.12.2', type: 'release' }
      ];
    }
    if (edition === 'glowstone') {
      return [
        { id: '2024.1.0', type: 'release', downloadUrl: 'https://repo.glowstone.net/repository/releases/org/glowstone/glowstone/2024.1.0/glowstone-2024.1.0-shard.jar' },
        { id: '2023.2.0', type: 'release', downloadUrl: 'https://repo.glowstone.net/repository/releases/org/glowstone/glowstone/2023.2.0/glowstone-2023.2.0-shard.jar' }
      ];
    }
    if (edition === 'quilt') {
      return [
        { id: '1.20.4', type: 'release', mcVersion: '1.20.4' },
        { id: '1.20.1', type: 'release', mcVersion: '1.20.1' },
        { id: '1.19.2', type: 'release', mcVersion: '1.19.2' }
      ];
    }
    return [];
  },

  async getDownloadUrl(edition, version) {
    if (edition === 'vanilla') {
      const versions = await this.getVanillaVersions();
      const matched = versions.find(v => v.id === version);
      if (!matched) throw new Error('Vanilla version not found');
      
      const response = await axios.get(matched.url);
      const serverDl = response.data?.downloads?.server?.url;
      if (!serverDl) throw new Error('No server download available for this Vanilla version');
      return serverDl;
    }

    if (edition === 'paper') {
      const buildsResponse = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
      const latestBuild = buildsResponse.data.builds[buildsResponse.data.builds.length - 1];
      
      const fileResponse = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}`);
      const fileName = fileResponse.data.downloads.application.name;
      
      return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/${fileName}`;
    }

    if (edition === 'purpur') {
      const response = await axios.get(`https://api.purpurmc.org/v2/purpur/${version}`);
      const latestBuild = response.data.builds.latest;
      return `https://api.purpurmc.org/v2/purpur/${version}/${latestBuild}/download`;
    }

    if (edition === 'fabric') {
      const loaderRes = await axios.get('https://meta.fabricmc.net/v2/versions/loader');
      const installerRes = await axios.get('https://meta.fabricmc.net/v2/versions/installer');
      
      const loader = loaderRes.data[0].version;
      const installer = installerRes.data[0].version;
      
      return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installer}/server/jar`;
    }

    if (edition === 'glowstone') {
      const versions = await this.getOtherVersions('glowstone');
      const matched = versions.find(v => v.id === version);
      if (matched) return matched.downloadUrl;
      throw new Error('Glowstone version download URL not found');
    }

    if (edition === 'bedrock') {
      const versions = await this.getOtherVersions('bedrock');
      const matched = versions.find(v => v.id === version);
      if (matched) return matched.downloadUrl;
      return `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${version}.zip`;
    }

    if (edition === 'forge') {
      const versions = await this.getOtherVersions('forge');
      const matched = versions.find(v => v.id === version);
      if (matched) {
        return `https://maven.minecraftforge.net/net/minecraftforge/forge/${matched.mcVersion}-${matched.forgeVersion}/forge-${matched.mcVersion}-${matched.forgeVersion}-installer.jar`;
      }
      throw new Error('Forge configuration mapping not found');
    }

    if (edition === 'neoforge') {
      return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    }

    if (edition === 'spigot') {
      return `https://download.getbukkit.org/spigot/spigot-${version}.jar`;
    }

    throw new Error(`Edition '${edition}' is not yet supported for automated downloads.`);
  },

  async startDownload(instanceId, downloadUrl, destinationFolder, customFileName = 'server.jar') {
    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }

    const destPath = path.join(destinationFolder, customFileName);
    const downloadInfo = {
      progress: 0,
      status: 'downloading',
      speed: '0 KB/s',
      bytesDownloaded: 0,
      bytesTotal: 0,
      error: null
    };

    activeDownloads.set(instanceId, downloadInfo);

    try {
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
      });

      const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
      downloadInfo.bytesTotal = totalBytes;

      const writer = fs.createWriteStream(destPath);
      let downloaded = 0;
      let startTime = Date.now();

      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        downloadInfo.bytesDownloaded = downloaded;
        
        if (totalBytes > 0) {
          downloadInfo.progress = Math.round((downloaded / totalBytes) * 100);
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        if (elapsedSeconds > 0.5) {
          const speedBytes = downloaded / elapsedSeconds;
          if (speedBytes > 1024 * 1024) {
            downloadInfo.speed = `${(speedBytes / (1024 * 1024)).toFixed(2)} MB/s`;
          } else {
            downloadInfo.speed = `${(speedBytes / 1024).toFixed(2)} KB/s`;
          }
        }
      });

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          downloadInfo.status = 'completed';
          downloadInfo.progress = 100;
          resolve(destPath);
        });

        writer.on('error', (err) => {
          downloadInfo.status = 'failed';
          downloadInfo.error = err.message;
          reject(err);
        });
      });

    } catch (error) {
      downloadInfo.status = 'failed';
      downloadInfo.error = error.message;
      throw error;
    }
  }
};
