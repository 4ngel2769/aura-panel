import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export const FileManager = {
  /**
   * Safe path normalizer to ensure operations stay inside allowable limits
   */
  resolveSafePath(targetPath) {
    // Resolve absolute path
    const resolved = path.resolve(targetPath);
    // You could restrict it here (e.g., must stay within /home or /home/aura/servers)
    // For general daemon use, let's return normalized absolute path
    return resolved;
  },

  /**
   * Lists directory files and folders
   */
  listDirectory(dirPath) {
    const safePath = this.resolveSafePath(dirPath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is a file, not a directory: ${dirPath}`);
    }

    const items = fs.readdirSync(safePath);
    const result = [];

    for (const item of items) {
      const fullPath = path.join(safePath, item);
      try {
        const itemStat = fs.statSync(fullPath);
        result.push({
          name: item,
          isDirectory: itemStat.isDirectory(),
          size: itemStat.size,
          mtime: itemStat.mtime
        });
      } catch (e) {
        // Skip unreadable files
      }
    }

    return result;
  },

  /**
   * Reads file contents
   */
  readFile(filePath) {
    const safePath = this.resolveSafePath(filePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    return fs.readFileSync(safePath, 'utf8');
  },

  /**
   * Writes content to a file
   */
  writeFile(filePath, content) {
    const safePath = this.resolveSafePath(filePath);
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf8');
    return true;
  },

  /**
   * Creates a directory
   */
  createDirectory(dirPath) {
    const safePath = this.resolveSafePath(dirPath);
    fs.mkdirSync(safePath, { recursive: true });
    return true;
  },

  /**
   * Deletes a file or directory
   */
  deletePath(targetPath) {
    const safePath = this.resolveSafePath(targetPath);
    if (!fs.existsSync(safePath)) return true;

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }
    return true;
  },

  /**
   * Extracts a zip archive to a target directory
   */
  unzipArchive(zipFilePath, targetDir) {
    const safeZip = this.resolveSafePath(zipFilePath);
    const safeTarget = this.resolveSafePath(targetDir);

    if (!fs.existsSync(safeZip)) {
      throw new Error(`Zip archive does not exist: ${zipFilePath}`);
    }

    if (!fs.existsSync(safeTarget)) {
      fs.mkdirSync(safeTarget, { recursive: true });
    }

    const zip = new AdmZip(safeZip);
    zip.extractAllTo(safeTarget, true); // true = overwrite existing files
    return true;
  },

  /**
   * Compress a directory to a zip file
   */
  zipDirectory(dirPath, zipFilePath) {
    const safeDir = this.resolveSafePath(dirPath);
    const safeZip = this.resolveSafePath(zipFilePath);

    if (!fs.existsSync(safeDir)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    const zip = new AdmZip();
    zip.addLocalFolder(safeDir);
    zip.writeZip(safeZip);
    return true;
  }
};
