import type { Types } from 'mongoose';
import AuditLog from '../models/AuditLog';

interface LogActionParams {
  action:       string;
  performedBy:  string | Types.ObjectId;
  targetId?:    string | Types.ObjectId;
  targetModel?: string;
  metadata?:    Record<string, unknown>;
}

export async function logAction(params: LogActionParams): Promise<void> {
  await AuditLog.create({
    action:      params.action,
    performedBy: params.performedBy,
    targetId:    params.targetId,
    targetModel: params.targetModel,
    metadata:    params.metadata,
  });
}
