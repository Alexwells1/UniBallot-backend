import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log('✅ MongoDB connected');
    await createIndexes();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

export async function createIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  try {
    await db.collection('associationmembers').createIndex(
      { electionId: 1, matricNumber: 1 },   { unique: true, background: true }
    );

    // RegisteredVoter compound index
    await db.collection('registeredvoters').createIndex(
      { electionId: 1, userId: 1 },         { unique: true, background: true }
    );

    // Vote compound unique + regular indexes
    await db.collection('votes').createIndex(
      { electionId: 1, officeId: 1, ballotToken: 1 }, { unique: true, background: true }
    );
    await db.collection('votes').createIndex({ electionId: 1 }, { background: true });
    await db.collection('votes').createIndex({ officeId:   1 }, { background: true });

    // OtpVerification TTL + unique email
    await db.collection('otpverifications').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, background: true }
    );
    await db.collection('otpverifications').createIndex(
      { email: 1 },     { unique: true, background: true }
    );

    // RefreshToken TTL + unique token + userId index
    await db.collection('refreshtokens').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, background: true }
    );
    await db.collection('refreshtokens').createIndex(
      { token: 1 },     { unique: true, background: true }
    );
    await db.collection('refreshtokens').createIndex(
      { userId: 1 },    { background: true }
    );

    // AuditLog createdAt index
    await db.collection('auditlogs').createIndex({ createdAt: 1 }, { background: true });

    console.log('✅ Database indexes ensured');
  } catch (error) {
    // Non-fatal — existing indexes with same spec are idempotent
    console.error('⚠️  Index creation warning:', error);
  }
}
