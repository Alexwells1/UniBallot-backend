import mongoose, { Document, Schema } from 'mongoose';

export type SuppressionReason = 'bounce' | 'complaint';

export interface ISuppressedAddress extends Document {
  email:     string;
  reason:    SuppressionReason;
  createdAt: Date;
}

const SuppressedAddressSchema = new Schema<ISuppressedAddress>(
  {
    email:  { type: String, required: true, unique: true, lowercase: true, index: true },
    reason: { type: String, enum: ['bounce', 'complaint'], required: true },
  },
  { timestamps: true }
);

export const SuppressedAddress = mongoose.model<ISuppressedAddress>(
  'SuppressedAddress',
  SuppressedAddressSchema
);