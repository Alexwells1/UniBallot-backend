import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRegisteredVoter extends Document {
  _id: Types.ObjectId;
  electionId: Types.ObjectId;
  userId: Types.ObjectId;
  hasVoted: boolean;
  ballotToken?: string;
  receiptCode?: string;
  votedAt?: Date;
}

const registeredVoterSchema = new Schema<IRegisteredVoter>({
  electionId:  { type: Schema.Types.ObjectId, ref: 'Election', required: true },
  userId:      { type: Schema.Types.ObjectId, ref: 'User',     required: true },
  hasVoted:    { type: Boolean, default: false },
  ballotToken: { type: String },
  receiptCode: { type: String },
  votedAt:     { type: Date },
});

// Compound index defined in database.ts
export default mongoose.model<IRegisteredVoter>('RegisteredVoter', registeredVoterSchema);
