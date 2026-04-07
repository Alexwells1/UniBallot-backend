import mongoose from 'mongoose';
import { env } from './env';

/**
 * Connects to MongoDB Atlas with a connection pool tuned for 6,000 concurrent users.
 * Atlas M10 supports up to 1,500 connections; this instance reserves 300 per node
 * to allow horizontal scaling across multiple backend replicas.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize:              300,
      minPoolSize:              10,
      waitQueueTimeoutMS:       10_000,
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS:          45_000,
      heartbeatFrequencyMS:     10_000,
    });
    console.log('✅ MongoDB connected');
    await createIndexes();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected — scheduling reconnect in 3 s');
    setTimeout(() => {
      mongoose.connect(env.MONGO_URI).catch((e) =>
        console.error('[db] reconnect failed:', e)
      );
    }, 3_000);
  });
}

/**
 * Ensures all performance-critical and constraint indexes exist.
 * Safe to call on every startup — createIndex is idempotent.
 */
export async function createIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  try {
    // AssociationMember
    await db.collection('associationmembers').createIndex(
      { electionId: 1, matricNumber: 1 }, { unique: true, background: true }
    );

    // RegisteredVoter — compound covering hasVoted for the listMyElections aggregate
    await db.collection('registeredvoters').createIndex(
      { electionId: 1, userId: 1 }, { unique: true, background: true }
    );
    await db.collection('registeredvoters').createIndex(
      { electionId: 1, userId: 1, hasVoted: 1 }, { background: true }
    );
    await db.collection('registeredvoters').createIndex(
      { electionId: 1, receiptCode: 1 }, { background: true }
    );

    // Vote unique constraint + supporting indexes
    await db.collection('votes').createIndex(
      { electionId: 1, officeId: 1, ballotToken: 1 }, { unique: true, background: true }
    );
    await db.collection('votes').createIndex({ electionId: 1 }, { background: true });
    await db.collection('votes').createIndex({ officeId: 1 }, { background: true });
    await db.collection('votes').createIndex(
      { electionId: 1, createdAt: -1 },
      { partialFilterExpression: { electionId: { $exists: true } }, background: true }
    );

    // Candidate — F-06: missing indexes caused collection scans on every ballot fetch
    await db.collection('candidates').createIndex({ officeId: 1 }, { background: true });
    await db.collection('candidates').createIndex({ electionId: 1 }, { background: true });

    // OtpVerification TTL + unique email
    await db.collection('otpverifications').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, background: true }
    );
    await db.collection('otpverifications').createIndex(
      { email: 1 }, { unique: true, background: true }
    );

    // RefreshToken TTL + lookup indexes
    await db.collection('refreshtokens').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, background: true }
    );
    await db.collection('refreshtokens').createIndex(
      { token: 1 }, { unique: true, background: true }
    );
    await db.collection('refreshtokens').createIndex(
      { userId: 1 }, { background: true }
    );

    // AuditLog — F-13: compound index for action+targetModel+date queries
    await db.collection('auditlogs').createIndex({ createdAt: 1 }, { background: true });
    await db.collection('auditlogs').createIndex(
      { performedBy: 1, createdAt: -1 }, { background: true }
    );
    await db.collection('auditlogs').createIndex(
      { targetModel: 1, action: 1, createdAt: -1 }, { background: true }
    );

    // Elections
    await db.collection('elections').createIndex(
      { assignedOfficerId: 1, status: 1 }, { background: true }
    );
    await db.collection('elections').createIndex({ status: 1 }, { background: true });
    await db.collection('elections').createIndex({ associationId: 1 }, { background: true });

    console.log('✅ Database indexes ensured');
  } catch (error) {
    console.error('⚠️  Index creation warning:', error);
  }
}
