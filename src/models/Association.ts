import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAssociation extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const associationSchema = new Schema<IAssociation>(
  {
    name:        { type: String, required: true, unique: true, trim: true },
    description: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IAssociation>('Association', associationSchema);
