const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Allow-list of mime types so someone can't upload arbitrary executables
// disguised as evidence. 25MB cap per file keeps this cheap on the free tier.
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp3|wav|ogg|m4a|webm)|video\/(mp4|webm|quicktime))$/;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.test(file.mimetype)) {
      return cb(new Error('Unsupported file type. Only images, audio, and video are allowed.'));
    }
    cb(null, true);
  },
});

function evidenceKind(mimetype) {
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'other';
}

// POST /api/upload  — multipart/form-data, field name "file"
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file received.' });
    }
    res.json({
      ok: true,
      file: {
        url: `/uploads/${req.file.filename}`,
        kind: evidenceKind(req.file.mimetype),
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });
  });
});

module.exports = router;
