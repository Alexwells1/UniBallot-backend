import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAssociationMember extends Document {
  _id: Types.ObjectId;
  electionId: Types.ObjectId;
  matricNumber: string;
}

const associationMemberSchema = new Schema<IAssociationMember>({
  electionId:   { type: Schema.Types.ObjectId, ref: 'Election', required: true },
  matricNumber: { type: String, required: true, trim: true },
});

associationMemberSchema.index({ electionId: 1, matricNumber: 1 }, { unique: true });

export default mongoose.model<IAssociationMember>('AssociationMember', associationMemberSchema);