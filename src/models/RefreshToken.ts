import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefreshToken extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  token: string;
  revoked: boolean;
  expiresAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token:     { type: String, required: true, unique: true },
  revoked:   { type: Boolean, default: false },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export default mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
