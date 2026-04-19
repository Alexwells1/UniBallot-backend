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
  // H-04: Use crypto.randomBytes for receipt code generation (done in voting service)
  receiptCode: { type: String },
  votedAt:     { type: Date },
});

// Primary double-vote guard — must be unique
registeredVoterSchema.index({ electionId: 1, userId: 1 }, { unique: true });

// H-04: Add unique index for receipt code per election
registeredVoterSchema.index({ electionId: 1, receiptCode: 1 }, { unique: true });

export default mongoose.model<IRegisteredVoter>('RegisteredVoter', registeredVoterSchema);