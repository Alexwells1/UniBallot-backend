import mongoose, { Document, Schema, Types } from 'mongoose';
import { ELECTION_STATUS_ORDER, ElectionStatus } from '../config/constants';
import { OfficeTally } from '../services/results.service';


export interface IElection extends Document {
  _id: Types.ObjectId;
  associationId: Types.ObjectId;
  title: string;
  description?: string;
  electionCode: string;
  status: ElectionStatus;
  assignedOfficerId?: Types.ObjectId;
  isLocked: boolean;
  candidatesLocked: boolean;
  membersLocked: boolean;
  results?: OfficeTally[] | null;
  createdAt: Date;
  updatedAt: Date;
}

const electionSchema = new Schema<IElection>(
  {
    associationId:     { type: Schema.Types.ObjectId, ref: 'Association', required: true },
    title:             { type: String, required: true, trim: true },
    description:       { type: String },
    electionCode:      { type: String, required: true, unique: true, uppercase: true },
    status:            { type: String, enum: ELECTION_STATUS_ORDER, default: 'draft', required: true },
    assignedOfficerId: { type: Schema.Types.ObjectId, ref: 'User' },
    isLocked:          { type: Boolean, default: false },
    candidatesLocked:  { type: Boolean, default: false },
    membersLocked:     { type: Boolean, default: false },
    results:           { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<IElection>('Election', electionSchema);
