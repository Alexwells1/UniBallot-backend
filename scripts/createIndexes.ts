import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { createIndexes } from '../src/config/database';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is required');
  process.exit(1);
}

async function run(): Promise<void> {
  await mongoose.connect(MONGO_URI!);
  console.log('✅ Connected to MongoDB');
  await createIndexes();
  console.log('✅ All indexes ensured');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ createIndexes failed:', err);
  process.exit(1);
});
