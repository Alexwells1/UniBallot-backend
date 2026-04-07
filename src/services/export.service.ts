
import { stringify } from 'csv-stringify/sync';
import PDFDocument from 'pdfkit';
import type { IElection } from '../models/Election';
import type { OfficeTally } from './results.service';

// ── CSV ───────────────────────────────────────────────────────────────────────

export function generateCsv(election: IElection, tally: OfficeTally[]): string {
  const rows: (string | number)[][] = [
    ['Election Title',  election.title],
    ['Election Code',   election.electionCode],
    ['Status',          election.status],
    ['Published At',    election.updatedAt.toISOString()],
    ['Exported At',     new Date().toISOString()],
    [],
    ['Office', 'Type', 'Total Votes', 'Result', 'Tie?'],
  ];

  for (const office of tally) {
    const result =
      office.voteType === 'competitive'
        ? office.isTie
          ? 'Tie'
          : `Winner: ${office.winner ?? 'unknown'}`
        : office.elected === true
        ? 'Elected'
        : office.elected === false
        ? 'Rejected'
        : 'Tie';

    rows.push([
      office.officeTitle,
      office.voteType,
      office.totalVotes,
      result,
      office.isTie ? 'Yes' : 'No',
    ]);

    for (const c of office.candidates) {
      rows.push(['', `  ${c.fullName}`, c.voteCount, '', '']);
    }
    rows.push([]);
  }

  return stringify(rows);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function streamPdf(
  election: IElection,
  tally: OfficeTally[],
  stream: NodeJS.WritableStream
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, bufferPages: false });
    doc.on('error', reject);
    stream.on('error', reject);
    doc.pipe(stream);

    // Header
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(election.title, { align: 'center' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#64748b')
      .text(
        `Code: ${election.electionCode}   Exported: ${new Date().toISOString()}`,
        { align: 'center' }
      );
    doc.moveDown(1.5);

    // Tally sections
    for (const office of tally) {
      doc
        .fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#1B3A6B')
        .text(office.officeTitle);

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#334155')
        .text(`Type: ${office.voteType}   Total votes: ${office.totalVotes}`);

      for (const c of office.candidates) {
        doc.text(`    ${c.fullName} — ${c.voteCount} vote${c.voteCount !== 1 ? 's' : ''}`);
      }

      // Result summary line
      if (office.voteType === 'competitive') {
        doc.text(
          office.isTie
            ? '  ⚖ Tie — manual resolution required'
            : `  ✓ Winner: ${office.winner ?? 'unknown'}`
        );
      } else {
        doc.text(
          office.isTie
            ? '  ⚖ Tie — manual resolution required'
            : office.elected
            ? '  ✓ Elected'
            : '  ✗ Rejected'
        );
      }

      doc.moveDown();
    }

    doc.end();
    doc.on('end', resolve);
  });
}
