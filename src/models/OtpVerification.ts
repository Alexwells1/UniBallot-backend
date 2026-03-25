import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOtpVerification extends Document {
  _id: Types.ObjectId;
  email: string;
  otpHash: string;
  attempts: number;
  resendAttempts: number;
  locked: boolean;           // set true when attempts or resendAttempts exhausted
  expiresAt: Date;
  passwordHash?: string;
  createdAt: Date;
  updatedAt: Date;           // managed manually — used for resend rate limiting
}

const otpVerificationSchema = new Schema<IOtpVerification>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    resendAttempts: {
      type: Number,
      default: 0,
    },
    locked: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    passwordHash: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
    },
    updatedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    // timestamps:true is intentionally OFF — we manage updatedAt manually
    // so resend rate limiting reads a reliable value after findOneAndUpdate.
    timestamps: false,
  }
);

export default mongoose.model<IOtpVerification>('OtpVerification', otpVerificationSchema);