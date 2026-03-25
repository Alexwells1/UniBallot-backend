import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  action: string;
  performedBy: Types.ObjectId;
  targetId?: Types.ObjectId;
  targetModel?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action:      { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetId:    { type: Schema.Types.ObjectId },
    targetModel: { type: String },
    metadata:    { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: 1 });

export default mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
