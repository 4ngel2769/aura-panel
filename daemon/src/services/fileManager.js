import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export const FileManager = {
  /**
   * Safe path normalizer to ensure operations stay inside allowable limits
   */
  resolveSafePath(targetPath, basePath) {
    if (!basePath) {
      throw new Error("Security Error: No basePath provided to resolveSafePath.");
    }

    // Ensure targetPath is treated relative to basePath if it's absolute
    let normalizedTarget = targetPath;
    if (path.isAbsolute(normalizedTarget)) {
       // if we want to support that it is an absolute path that is inside the base path.
       // actually, for security, the frontend should just send a relative path (like '/' or '/server.properties')
       // but since it currently sends absolute paths, we need to check if targetPath is ALREADY inside basePath.
       normalizedTarget = targetPath;
    } else {
       // but typically we should join basePath and targetPath
       normalizedTarget = path.join(basePath, targetPath);
    }
    
    // Actually, let's make it robust:
    // If targetPath is absolute and NOT inside basePath, that's an error.
    // If targetPath is absolute and inside basePath, it's fine.
    // If targetPath is relative, join to basePath.
    
    const resolved = path.resolve(path.isAbsolute(targetPath) ? targetPath : path.join(basePath, targetPath));
    const resolvedBase = path.resolve(basePath);

    if (!resolved.startsWith(resolvedBase)) {
      throw new Error(`Path traversal denied. Path \${resolved} is outside \${resolvedBase}`);
    }

    return resolved;
  },

  /**
   * Lists directory files and folders
   */
  listDirectory(dirPath, basePath) {
    const safePath = this.resolveSafePath(dirPath, basePath);
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
  readFile(filePath, basePath) {
    const safePath = this.resolveSafePath(filePath, basePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    return fs.readFileSync(safePath, 'utf8');
  },

  /**
   * Writes content to a file
   */
  writeFile(filePath, content, basePath) {
    const safePath = this.resolveSafePath(filePath, basePath);
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
  createDirectory(dirPath, basePath) {
    const safePath = this.resolveSafePath(dirPath, basePath);
    fs.mkdirSync(safePath, { recursive: true });
    return true;
  },

  /**
   * Deletes a file or directory
   */
  deletePath(targetPath, basePath) {
    const safePath = this.resolveSafePath(targetPath, basePath);
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
  unzipArchive(zipFilePath, targetDir, basePath) {
    // We assume the zip itself is within the instance bounds. If it's a template, the upload endpoint handles placing it there.
    const safeZip = this.resolveSafePath(zipFilePath, basePath);
    const safeTarget = this.resolveSafePath(targetDir, basePath);

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
  zipDirectory(dirPath, zipFilePath, basePath) {
    const safeDir = this.resolveSafePath(dirPath, basePath);
    const safeZip = this.resolveSafePath(zipFilePath, basePath);

    if (!fs.existsSync(safeDir)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    const zip = new AdmZip();
    zip.addLocalFolder(safeDir);
    zip.writeZip(safeZip);
    return true;
  }
};
