import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';
import type { Types } from 'mongoose';
import AssociationMember from '../models/AssociationMember';
import { MATRIC_NUMBER_REGEX } from '../config/constants';
import { AppError } from '../utils/AppError';

const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS       = 50_000;

interface CsvError {
  row:          number;
  matricNumber: string;
  reason:       string;
}

export interface CsvUploadReport {
  processed:        number;
  inserted:         number;
  invalid:          number;
  duplicatesInFile: number;
  alreadyExisted:   number;
  errors:           CsvError[];
}

// ─── Column header normalisation ──────────────────────────────────────────────
// Strips spaces, underscores, hyphens and lowercases so that
// "Matric Number", "matric_number", "MatricNo", "matric" etc. all match.

function normaliseHeader(raw: string): string {
  return raw.toLowerCase().replace(/[\s_\-]+/g, '');
}

const MATRIC_ALIASES = new Set([
  'matric',
  'matricno',
  'matricnumber',
  'matricnumbers',
  'studentmatric',
  'studentmatricnumber',
  'student_matric',
  'student_matric_number',
]);

function findMatricColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (MATRIC_ALIASES.has(normaliseHeader(h))) return h;
  }
  return null;
}

// ─── File-type detection ──────────────────────────────────────────────────────
type FileKind = 'csv' | 'spreadsheet';

function detectKind(buffer: Buffer, filename: string): FileKind {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') return 'spreadsheet';

  // XLSX / ZIP magic bytes: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'spreadsheet';

  // XLS (CFBF) magic bytes: \xD0\xCF\x11\xE0
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return 'spreadsheet';

  return 'csv';
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseSpreadsheet(buffer: Buffer): Record<string, string>[] {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw:    false,
  });
  // Cast every cell value to a trimmed string
  return rows.map(r =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()]),
    ),
  );
}

function parseCsv(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    parse(
      buffer,
      {
        columns:            true,
        skip_empty_lines:   true,
        trim:               true,
        relax_column_count: true,
      },
      (err, records) => {
        if (err) return reject(err);
        resolve((records as Record<string, string>[]) ?? []);
      },
    );
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function processMembersCsv(
  buffer:     Buffer,
  electionId: string | Types.ObjectId,
  filename  = 'upload.csv',
): Promise<CsvUploadReport> {
  if (buffer.length > MAX_CSV_SIZE_BYTES) {
    throw new AppError(
      400,
      `File exceeds the maximum allowed size of ${MAX_CSV_SIZE_BYTES / (1024 * 1024)} MB`,
    );
  }

  // ── Parse rows from whichever format was uploaded ──
  const kind = detectKind(buffer, filename);
  let rows: Record<string, string>[];

  try {
    rows = kind === 'spreadsheet'
      ? parseSpreadsheet(buffer)
      : await parseCsv(buffer);
  } catch (err: any) {
    throw new AppError(400, `Failed to parse file: ${err.message ?? 'unknown error'}`);
  }

  if (rows.length > MAX_CSV_ROWS) {
    throw new AppError(400, `File exceeds the maximum of ${MAX_CSV_ROWS.toLocaleString()} rows`);
  }

  // ── Locate the matric-number column ──
  const headers   = rows.length ? Object.keys(rows[0]) : [];
  const matricCol = findMatricColumn(headers);

  if (!matricCol) {
    throw new AppError(
      400,
      'Could not find a matric number column. ' +
        'Expected a column named "matric", "matric_number", "matricnumber", or similar.',
    );
  }

  // ── Validate and deduplicate rows ──
  const report: CsvUploadReport = {
    processed:        rows.length,
    inserted:         0,
    invalid:          0,
    duplicatesInFile: 0,
    alreadyExisted:   0,
    errors:           [],
  };

  const seenMatrics = new Set<string>();
  const validRows:    string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum       = i + 2; // 1-based + skip header
    const matricNumber = (rows[i][matricCol] ?? '').trim();

    if (!matricNumber) {
      report.invalid++;
      report.errors.push({ row: rowNum, matricNumber, reason: 'Empty matric number' });
      continue;
    }

    if (!MATRIC_NUMBER_REGEX.test(matricNumber)) {
      report.invalid++;
      report.errors.push({
        row: rowNum,
        matricNumber,
        reason: 'Invalid matric number format',
      });
      continue;
    }

    if (seenMatrics.has(matricNumber)) {
      report.duplicatesInFile++;
      report.errors.push({
        row: rowNum,
        matricNumber,
        reason: 'Duplicate matric number in file',
      });
      continue;
    }

    seenMatrics.add(matricNumber);
    validRows.push(matricNumber);
  }

  if (validRows.length === 0) return report;

  // ── Cross-check against DB ──
  const existing = await AssociationMember.find(
    { electionId, matricNumber: { $in: validRows } },
    { matricNumber: 1 },
  );
  const existingSet = new Set(existing.map(e => e.matricNumber));

  const toInsert = validRows.filter(m => {
    if (existingSet.has(m)) {
      report.alreadyExisted++;
      return false;
    }
    return true;
  });

  // ── Bulk insert ──
  if (toInsert.length > 0) {
    try {
      const result = await AssociationMember.insertMany(
        toInsert.map(matricNumber => ({ electionId, matricNumber })),
        { ordered: false },
      );
      report.inserted = result.length;
    } catch (error: any) {
      if (error.code === 11000) {
        // Partial success — some docs were inserted before the duplicate was hit
        report.inserted = error.result?.nInserted ?? 0;
        report.duplicatesInFile++;
        report.errors.push({
          row:          0,
          matricNumber: error.keyValue?.matricNumber ?? 'unknown',
          reason:       'Duplicate key detected during database insert',
        });
      } else {
        throw error;
      }
    }
  }

  return report;
}