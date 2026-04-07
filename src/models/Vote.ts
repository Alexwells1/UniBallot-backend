import mongoose, { Document, Schema, Types } from 'mongoose';

export type ConfirmationChoice = 'approve' | 'reject';

export interface IVote extends Document {
  _id: Types.ObjectId;
  electionId: Types.ObjectId;
  officeId: Types.ObjectId;
  candidateId?: Types.ObjectId;
  confirmationChoice?: ConfirmationChoice;
  ballotToken: string;
  voteHash: string;
  createdAt: Date;
}

const voteSchema = new Schema<IVote>(
  {
    electionId:         { type: Schema.Types.ObjectId, ref: 'Election',  required: true, immutable: true },
    officeId:           { type: Schema.Types.ObjectId, ref: 'Office',    required: true, immutable: true },
    candidateId:        { type: Schema.Types.ObjectId, ref: 'Candidate', immutable: true },
    confirmationChoice: { type: String, enum: ['approve', 'reject'],     immutable: true },
    ballotToken:        { type: String, required: true,                  immutable: true },
    voteHash:           { type: String, required: true,                  immutable: true },
    createdAt:          { type: Date,   required: true,                  immutable: true },
  },
  { timestamps: false, _id: true }
);

// Declared in-schema so the constraint is self-documenting and applied
// on any fresh database even if createIndexes() is not run separately.
// This is the primary idempotency guard — a duplicate (electionId, officeId,
// ballotToken) triple will throw code 11000 and the catch block in
// voting.service.ts handles it as VOTE_ALREADY_RECORDED.
voteSchema.index(
  { electionId: 1, officeId: 1, ballotToken: 1 },
  { unique: true }
);

// Supporting indexes for results queries
voteSchema.index({ electionId: 1 });
voteSchema.index({ officeId:   1 });

export default mongoose.model<IVote>('Vote', voteSchema);
