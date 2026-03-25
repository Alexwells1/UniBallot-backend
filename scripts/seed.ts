import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const MONGO_URI  = process.env.MONGO_URI;
const EMAIL      = process.env.SUPER_ADMIN_EMAIL;
const PASSWORD   = process.env.SUPER_ADMIN_PASSWORD;
const FULL_NAME  = process.env.SUPER_ADMIN_FULL_NAME;

interface IUser extends mongoose.Document {
  email: string;
  passwordHash: string;
  role: string;
  fullName: string;
  profileCompleted: boolean;
  isActive: boolean;
  isSuspended: boolean;
  mustChangePassword: boolean;
}

if (!MONGO_URI || !EMAIL || !PASSWORD || !FULL_NAME) {
  console.error(
    '❌ Missing required env vars: MONGO_URI, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_FULL_NAME'
  );
  process.exit(1);
}

async function seed(): Promise<void> {
  await mongoose.connect(MONGO_URI!);
  console.log('✅ Connected to MongoDB');

  // Inline schema avoids importing the full app stack
  const UserSchema = new mongoose.Schema(
    {
      email:              { type: String, required: true, unique: true, lowercase: true },
      passwordHash:       { type: String, required: true },
      role:               { type: String, required: true },
      fullName:           { type: String },
      profileCompleted:   { type: Boolean, default: false },
      isActive:           { type: Boolean, default: true },
      isSuspended:        { type: Boolean, default: false },
      mustChangePassword: { type: Boolean, default: false },
    },
    { timestamps: true }
  );

  const User = (mongoose.models['User'] as mongoose.Model<IUser>) 
          || mongoose.model<IUser>('User', UserSchema);

  const existing = await User.findOne({ email: EMAIL!.toLowerCase() });
  if (existing) {
    console.log(`ℹ️  Super admin already exists: ${EMAIL}`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD!, 12);
  await User.create({
    email:              EMAIL!.toLowerCase(),
    passwordHash,
    role:               'super_admin',
    fullName:           FULL_NAME,
    profileCompleted:   true,
    isActive:           true,
    isSuspended:        false,
    mustChangePassword: false,
  });

  console.log(`✅ Super admin seeded: ${EMAIL}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
