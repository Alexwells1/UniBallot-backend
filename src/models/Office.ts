import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOffice extends Document {
  _id: Types.ObjectId;
  electionId: Types.ObjectId;
  title: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const officeSchema = new Schema<IOffice>(
  {
    electionId:  { type: Schema.Types.ObjectId, ref: 'Election', required: true },
    title:       { type: String, required: true, trim: true },
    description: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IOffice>('Office', officeSchema);
