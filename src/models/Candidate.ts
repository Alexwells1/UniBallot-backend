import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICandidate extends Document {
  _id: Types.ObjectId;
  officeId: Types.ObjectId;
  electionId: Types.ObjectId;
  fullName: string;
  bio?: string;
  photoUrl?: string;
  photoPublicId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const candidateSchema = new Schema<ICandidate>(
  {
    officeId:      { type: Schema.Types.ObjectId, ref: 'Office',    required: true },
    electionId:    { type: Schema.Types.ObjectId, ref: 'Election',  required: true },
    fullName:      { type: String, required: true, trim: true },
    bio:           { type: String },
    photoUrl:      { type: String },
    photoPublicId: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ICandidate>('Candidate', candidateSchema);
