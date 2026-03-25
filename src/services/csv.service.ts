import { parse } from 'csv-parse';
import type { Types } from 'mongoose';
import AssociationMember from '../models/AssociationMember';
import { MATRIC_NUMBER_REGEX } from '../config/constants';

interface CsvRow {
  matric_number: string;
}

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

  const seenMatrics = new Set<string>();
  const validRows: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row          = rows[i];
    const rowNum       = i + 2; // 1-based index + skip header
    const matricNumber = (row.matric_number ?? '').trim();

    // Check for empty rows
    if (!matricNumber) {
      report.invalid++;
      report.errors.push({ row: rowNum, matricNumber, reason: 'Empty matric number' });
      continue;
    }

    // Validate format against regex
    if (!MATRIC_NUMBER_REGEX.test(matricNumber)) {
      report.invalid++;
      report.errors.push({ row: rowNum, matricNumber, reason: 'Invalid matric number format' });
      continue;
    }

    // Check for duplicates within the file
    if (seenMatrics.has(matricNumber)) {
      report.duplicatesInFile++;
      report.errors.push({ row: rowNum, matricNumber, reason: 'Duplicate matric number in file' });
      continue;
    }

    seenMatrics.add(matricNumber);
    validRows.push(matricNumber);
  }

  // Return early if no valid rows
  if (validRows.length === 0) return report;

  // Cross-check against existing DB records for this election
  const existingMatrics = await AssociationMember.find(
    { electionId, matricNumber: { $in: validRows } },
    { matricNumber: 1 }
  );

  const existingMatricSet = new Set(existingMatrics.map((e) => e.matricNumber));

  // Filter out members that already exist in the election
  const toInsert = validRows.filter((matricNumber) => {
    if (existingMatricSet.has(matricNumber)) {
      report.alreadyExisted++;
      return false;
    }
    return true;
  });

  // Insert valid, new records
  if (toInsert.length > 0) {
    const docs = toInsert.map((matricNumber) => ({ electionId, matricNumber }));
    try {
      const result = await AssociationMember.insertMany(docs, { ordered: false });
      report.inserted = result.length;
    } catch (error: any) {
      // Handle duplicate key errors that might occur during database insert
      if (error.code === 11000) {
        // Extract the duplicate key field
        const duplicateField = Object.keys(error.keyValue || {})[1];
        const duplicateValue = error.keyValue?.[duplicateField];
        
        report.duplicatesInFile++;
        report.errors.push({
          row: 0,
          matricNumber: duplicateValue || 'unknown',
          reason: 'Duplicate key detected during database insert',
        });
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }

  return report;
}

/**
 * Parse CSV buffer into array of rows
 * Expects: matric_number column
 * Ignores: extra columns, empty lines
 */
function parseCsv(buffer: Buffer): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    parse(
      buffer,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // Allow CSV to have extra columns (they'll be ignored)
      },
      (err, records: CsvRow[]) => {
        if (err) return reject(err);
        resolve(records || []);
      }
    );
  });
}