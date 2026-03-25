import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAvatar extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  url: string;
  publicId: string;
  createdAt: Date;
  updatedAt: Date;
}

const avatarSchema = new Schema<IAvatar>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    url:      { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IAvatar>('Avatar', avatarSchema);
