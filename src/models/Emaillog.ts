import mongoose, { Document, Schema } from 'mongoose';

export type EmailStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'retrying'
  | 'permanently_failed';

export type EmailProvider = 'ses' | 'resend';

export type FailureType = 'temporary' | 'permanent';

export interface IEmailLog extends Document {
  jobId:         string;
  to:            string;
  subject:       string;
  status:        EmailStatus;
  provider?:     EmailProvider;
  attempts:      number;
  maxAttempts:   number;
  failureType?:  FailureType;
  failureReason?: string;
  bouncedAt?:    Date;
  complaintAt?:  Date;
  createdAt:     Date;
  updatedAt:     Date;
}

const EmailLogSchema = new Schema<IEmailLog>(
  {
    jobId:          { type: String, required: true, unique: true, index: true },
    to:             { type: String, required: true, index: true },
    subject:        { type: String, required: true },
    status:         {
      type: String,
      enum: ['queued', 'sent', 'failed', 'retrying', 'permanently_failed'],
      default: 'queued',
      index: true,
    },
    provider:       { type: String, enum: ['ses', 'resend'] },
    attempts:       { type: Number, default: 0 },
    maxAttempts:    { type: Number, default: 3 },
    failureType:    { type: String, enum: ['temporary', 'permanent'] },
    failureReason:  { type: String },
    bouncedAt:      { type: Date },
    complaintAt:    { type: Date },
  },
  { timestamps: true }
);

export const EmailLog = mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);