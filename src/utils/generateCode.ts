import crypto from 'crypto';
import Election from '../models/Election';
import { ELECTION_CODE_LENGTH } from '../config/constants';

/**
 * Architecture spec: crypto.randomBytes(6) converted to base36,
 * uppercased, trimmed/padded to exactly 8 characters.
 * Retries up to 5 times on collision before throwing.
 */
export async function generateElectionCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw  = BigInt('0x' + crypto.randomBytes(6).toString('hex'))
      .toString(36)
      .toUpperCase()
      .padStart(ELECTION_CODE_LENGTH, '0')
      .slice(-ELECTION_CODE_LENGTH);

    const exists = await Election.findOne({ electionCode: raw });
    if (!exists) return raw;
  }
  throw new Error('Failed to generate a unique election code after 5 attempts');
}
