// scripts/migrateAvatarLocked.ts
import mongoose, { Document, Schema, Types } from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') }); // ← explicit root path


dotenv.config();

// ── Inline User type + model (no src import) ──────────────────────────────────

type UserRole   = 'super_admin' | 'officer' | 'student';
type UserGender = 'male' | 'female' | 'other';

interface IUser extends Document {
  _id:                Types.ObjectId;
  email:              string;
  passwordHash:       string;
  role:               UserRole;
  fullName?:          string;
  matricNumber?:      string;
  gender?:            UserGender;
  avatarPath?:        string;
  avatarLocked:       boolean;
  profileCompleted:   boolean;
  isActive:           boolean;
  isSuspended:        boolean;
  mustChangePassword: boolean;
  createdAt:          Date;
  updatedAt:          Date;
}

const userSchema = new Schema<IUser>(
  {
    email:              { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:       { type: String, required: true },
    role:               { type: String, enum: ['super_admin', 'officer', 'student'], required: true },
    fullName:           { type: String, trim: true },
    matricNumber:       { type: String, sparse: true, unique: true },
    gender:             { type: String, enum: ['male', 'female', 'other'] },
    avatarPath:         { type: String },
    avatarLocked:       { type: Boolean, default: false },
    profileCompleted:   { type: Boolean, default: false },
    isActive:           { type: Boolean, default: true },
    isSuspended:        { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const User = mongoose.model<IUser>('User', userSchema);

const MONGO_URI  = "mongodb+srv://mikununiballot:mikun@uniballotdatabase.elw9ujk.mongodb.net/?appName=uniballotdatabase"

// ── Migration ─────────────────────────────────────────────────────────────────

async function migrate() {
  await mongoose.connect(MONGO_URI!);
  console.log('Connected to MongoDB\n');

  // Users WITH an avatarPath → avatarLocked: true
  const withAvatar = await User.updateMany(
    {
      avatarPath:   { $exists: true, $nin: [null, ''] }, // ← $nin replaces the duplicate $ne
      avatarLocked: { $exists: false },
    },
    { $set: { avatarLocked: true } },
  );
  console.log(`✔ Locked  : ${withAvatar.modifiedCount} users (had avatarPath)`);

  // Users WITHOUT an avatarPath → avatarLocked: false
  const withoutAvatar = await User.updateMany(
    {
      $or: [
        { avatarPath: { $exists: false } },
        { avatarPath: null },
        { avatarPath: '' },
      ],
      avatarLocked: { $exists: false },
    },
    { $set: { avatarLocked: false } },
  );
  console.log(`✔ Unlocked: ${withoutAvatar.modifiedCount} users (no avatarPath)`);

  const total = withAvatar.modifiedCount + withoutAvatar.modifiedCount;
  console.log(`\nDone — ${total} documents updated`);

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});