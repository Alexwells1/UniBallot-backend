import multer from 'multer';
import { AppError } from '../utils/AppError';
import { ALLOWED_UPLOAD_MIME_TYPES } from '../config/constants';

const AVATAR_SIZE_LIMIT    = 5 * 1024 * 1024; // 5 MB
const CANDIDATE_SIZE_LIMIT = 8 * 1024 * 1024; // 8 MB
const CSV_SIZE_LIMIT       = 5 * 1024 * 1024; // 5 MB

function imageFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  if (
    !ALLOWED_UPLOAD_MIME_TYPES.includes(
      file.mimetype as (typeof ALLOWED_UPLOAD_MIME_TYPES)[number],
    )
  ) {
    cb(new AppError(400, 'Only JPEG, PNG, and WebP images are allowed'));
    return;
  }
  cb(null, true);
}

/** Avatar upload — form field name: "avatar" */
export const uploadAvatar = multer({
  storage:    multer.memoryStorage(),
  limits:     { fileSize: AVATAR_SIZE_LIMIT },
  fileFilter: imageFilter,
}).single('avatar');

/** Candidate photo — form field name: "photo" */
export const uploadPhoto = multer({
  storage:    multer.memoryStorage(),
  limits:     { fileSize: CANDIDATE_SIZE_LIMIT },
  fileFilter: imageFilter,
}).single('photo');

/** Membership CSV/spreadsheet — form field name: "file" */
export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: CSV_SIZE_LIMIT },
  fileFilter(_req, file, cb) {
    const allowedMimes = [
      'text/csv',
      'text/plain',
      'application/octet-stream',
      'application/vnd.ms-excel',                                          // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.oasis.opendocument.spreadsheet',                    // .ods
    ];

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const allowedExts = ['csv', 'xlsx', 'xls', 'ods'];

    const mimeOk = allowedMimes.includes(file.mimetype);
    const extOk  = allowedExts.includes(ext ?? '');

    if (!mimeOk && !extOk) {
      cb(new AppError(400, 'Only CSV, XLSX, XLS, and ODS files are allowed'));
      return;
    }

    cb(null, true);
  },
}).single('file');