import { Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { config } from '../config/environment';

// Ensure media uploads directory exists
const mediaUploadDir = path.resolve(config.uploadDir, 'media');
if (!fs.existsSync(mediaUploadDir)) {
  fs.mkdirSync(mediaUploadDir, { recursive: true });
}

// Multer storage engine
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, mediaUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// File filter supporting images, audio, video, and documents
const fileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = [
    // Images
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    // Audio
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/x-m4a', 'audio/m4a',
    // Video
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    // Documents
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'text/plain'
  ];

  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
};

export const mediaUploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100 MB maximum size
  },
  fileFilter
}).single('file');

export class MediaController {
  async uploadMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded or invalid form field' }
        });
        return;
      }

      const file = req.file;
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      const mediaUrl = `${protocol}://${host}/uploads/media/${file.filename}`;

      res.status(200).json({
        success: true,
        data: {
          mediaUrl,
          relativeUrl: `/uploads/media/${file.filename}`,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size
        }
      });
    } catch (error: any) {
      console.error('[MediaController] Upload error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to process media file' }
      });
    }
  }
}

export const mediaController = new MediaController();
