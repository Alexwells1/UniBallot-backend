import { parse } from 'csv-parse';
import { z } from 'zod';
import type { Types } from 'mongoose';
import AssociationMember from '../models/AssociationMember';
import { MATRIC_NUMBER_REGEX } from '../config/constants';

interface CsvRow {
  email:         string;
  matric_number: string;
}

interface CsvError {
  row:          number;
  email:        string;
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

const emailSchema = z.string().email();

export async function processMembersCsv(
  buffer:     Buffer,
  electionId: string | Types.ObjectId
): Promise<CsvUploadReport> {
  const rows = await parseCsv(buffer);

  const report: CsvUploadReport = {
    processed:        rows.length,
    inserted:         0,
    invalid:          0,
    duplicatesInFile: 0,
    alreadyExisted:   0,
    errors:           [],
  };

  const seenEmails  = new Set<string>();
  const seenMatrics = new Set<string>();
  const validRows: Array<{ email: string; matricNumber: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row        = rows[i];
    const rowNum     = i + 2; // 1-based + skip header
    const email      = (row.email ?? '').toLowerCase().trim();
    const matricNumber = (row.matric_number ?? '').trim();

    if (!emailSchema.safeParse(email).success) {
      report.invalid++;
      report.errors.push({ row: rowNum, email, matricNumber, reason: 'Invalid email format' });
      continue;
    }

    if (!MATRIC_NUMBER_REGEX.test(matricNumber)) {
      report.invalid++;
      report.errors.push({ row: rowNum, email, matricNumber, reason: 'Invalid matric number format' });
      continue;
    }

    if (seenEmails.has(email)) {
      report.duplicatesInFile++;
      report.errors.push({ row: rowNum, email, matricNumber, reason: 'Duplicate email in file' });
      continue;
    }
    if (seenMatrics.has(matricNumber)) {
      report.duplicatesInFile++;
      report.errors.push({ row: rowNum, email, matricNumber, reason: 'Duplicate matric number in file' });
      continue;
    }

    seenEmails.add(email);
    seenMatrics.add(matricNumber);
    validRows.push({ email, matricNumber });
  }

  if (validRows.length === 0) return report;

  // Cross-check against existing DB records for this election
  const [existingEmails, existingMatrics] = await Promise.all([
    AssociationMember.find(
      { electionId, email: { $in: validRows.map((r) => r.email) } },
      { email: 1 }
    ),
    AssociationMember.find(
      { electionId, matricNumber: { $in: validRows.map((r) => r.matricNumber) } },
      { matricNumber: 1 }
    ),
  ]);

  const existingEmailSet  = new Set(existingEmails.map((e) => e.email));
  const existingMatricSet = new Set(existingMatrics.map((e) => e.matricNumber));

  const toInsert = validRows.filter((row) => {
    if (existingEmailSet.has(row.email) || existingMatricSet.has(row.matricNumber)) {
      report.alreadyExisted++;
      return false;
    }
    return true;
  });

  if (toInsert.length > 0) {
    const docs   = toInsert.map((row) => ({ electionId, email: row.email, matricNumber: row.matricNumber }));
    const result = await AssociationMember.insertMany(docs, { ordered: false });
    report.inserted = result.length;
  }

  return report;
}

function parseCsv(buffer: Buffer): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    parse(
      buffer,
      { columns: true, skip_empty_lines: true, trim: true },
      (err, records: CsvRow[]) => {
        if (err) return reject(err);
        resolve(records);
      }
    );
  });
}
