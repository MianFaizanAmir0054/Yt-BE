import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { stat } from 'fs/promises';

const router = express.Router();

function resolveWildcardPath(rawPath: string | string[] | undefined): string {
  if (!rawPath) return "";
  if (Array.isArray(rawPath)) {
    return rawPath.join("/");
  }
  return rawPath;
}

// Content types mapping
const CONTENT_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  // Documents
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.srt': 'text/plain',
  '.txt': 'text/plain',
  '.vtt': 'text/vtt',
};

/**
 * GET /api/files/uploads/*path
 * Serve files from the uploads directory
 */
router.get('/uploads/*path', async (req: Request, res: Response) => {
  try {
    // Get the file path from the URL (Express 5 uses named wildcard)
    const rawPath = req.params.path || req.params[0];
    const filePath = resolveWildcardPath(rawPath);
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const fullPath = path.join(uploadsDir, normalizedPath);

    // Verify the file is within uploads directory
    if (!fullPath.startsWith(uploadsDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Check if file exists and is a file
    let fileStats;
    try {
      fileStats = await stat(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!fileStats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Read the file
    const fileBuffer = await fs.readFile(fullPath);
    
    // Determine content type based on extension
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    return res.send(fileBuffer);
  } catch (error) {
    console.error('File serve error:', error);
    return res.status(500).json({ error: 'Failed to serve file' });
  }
});

/**
 * GET /api/files/outputs/*path
 * Serve files from the outputs directory (generated videos, audio, etc.)
 */
router.get('/outputs/*path', async (req: Request, res: Response) => {
  try {
    const rawPath = req.params.path || req.params[0];
    const filePath = resolveWildcardPath(rawPath);
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const outputsDir = path.join(process.cwd(), 'outputs');
    const fullPath = path.join(outputsDir, normalizedPath);

    // Verify the file is within outputs directory
    if (!fullPath.startsWith(outputsDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Check if file exists and is a file
    let fileStats;
    try {
      fileStats = await stat(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!fileStats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Read the file
    const fileBuffer = await fs.readFile(fullPath);
    
    // Determine content type
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache for outputs

    return res.send(fileBuffer);
  } catch (error) {
    console.error('File serve error:', error);
    return res.status(500).json({ error: 'Failed to serve file' });
  }
});

/**
 * GET /api/files/thumbnails/*path
 * Serve thumbnail images
 */
router.get('/thumbnails/*path', async (req: Request, res: Response) => {
  try {
    const rawPath = req.params.path || req.params[0];
    const filePath = resolveWildcardPath(rawPath);
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const thumbnailsDir = path.join(process.cwd(), 'uploads', 'thumbnails');
    const fullPath = path.join(thumbnailsDir, normalizedPath);

    if (!fullPath.startsWith(thumbnailsDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    let fileStats;
    try {
      fileStats = await stat(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!fileStats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileBuffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hour cache

    return res.send(fileBuffer);
  } catch (error) {
    console.error('Thumbnail serve error:', error);
    return res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

export default router;
