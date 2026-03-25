import multer from 'multer';
import { AppError } from '../utils/AppError';
import { MAX_UPLOAD_SIZE_BYTES, ALLOWED_UPLOAD_MIME_TYPES } from '../config/constants';

function imageFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype as typeof ALLOWED_UPLOAD_MIME_TYPES[number])) {
    cb(new AppError(400, 'Only JPEG, PNG, and WebP images are allowed'));
    return;
  }
  cb(null, true);
}

/** Avatar upload  — form field name: "avatar" */
export const uploadAvatar = multer({
  storage:    multer.memoryStorage(),
  limits:     { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: imageFilter,
}).single('avatar');

/** Candidate photo — form field name: "photo" */
export const uploadPhoto = multer({
  storage:    multer.memoryStorage(),
  limits:     { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: imageFilter,
}).single('photo');

/** Membership CSV  — form field name: "file" */
export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'text/plain',
      'application/octet-stream',
    ];
    if (!allowed.includes(file.mimetype)) {
      cb(new AppError(400, 'Only CSV files are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('file');
