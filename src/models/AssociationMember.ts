import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAssociationMember extends Document {
  _id: Types.ObjectId;
  electionId: Types.ObjectId;
  email: string;
  matricNumber: string;
}

const associationMemberSchema = new Schema<IAssociationMember>({
  electionId:    { type: Schema.Types.ObjectId, ref: 'Election', required: true },
  email:         { type: String, required: true, lowercase: true, trim: true },
  matricNumber:  { type: String, required: true },
});

// Compound indexes defined in database.ts
export default mongoose.model<IAssociationMember>('AssociationMember', associationMemberSchema);
