import { EmailLog } from "../../models/Emaillog";
import { SuppressedAddress } from "../../models/Suppressedaddress";
import { emailQueue, emailRetryQueue } from "../../services/email/Emailqueue.service";

export const getDashboardStats = async () => {
  const [
    total,
    sent,
    queued,
    retrying,
    permanentlyFailed,
    bounced,
    complained,
    suppressed,
  ] = await Promise.all([
    EmailLog.countDocuments(),
    EmailLog.countDocuments({ status: 'sent' }),
    EmailLog.countDocuments({ status: 'queued' }),
    EmailLog.countDocuments({ status: 'retrying' }),
    EmailLog.countDocuments({ status: 'permanently_failed' }),
    EmailLog.countDocuments({ bouncedAt: { $exists: true } }),
    EmailLog.countDocuments({ complaintAt: { $exists: true } }),
    SuppressedAddress.countDocuments(),
  ]);

  const [mainQueueCounts, retryQueueCounts] = await Promise.all([
    emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    emailRetryQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
  ]);

  return {
    emails: { total, sent, queued, retrying, permanentlyFailed, bounced, complained },
    suppressed,
    queues: {
      main: mainQueueCounts,
      retry: retryQueueCounts,
    },
  };
};

export const getEmailLogs = async (page = 1, limit = 20, status?: string, to?: string) => {
  const filter: Record<string, any> = {};
  if (status) filter.status = status;
  if (to)     filter.to = { $regex: to, $options: 'i' };

  const [logs, total] = await Promise.all([
    EmailLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EmailLog.countDocuments(filter),
  ]);

  return { logs, total, page, limit, pages: Math.ceil(total / limit) };
};

export const getSuppressedList = async (page = 1, limit = 20) => {
  const [list, total] = await Promise.all([
    SuppressedAddress.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SuppressedAddress.countDocuments(),
  ]);

  return { list, total, page, limit, pages: Math.ceil(total / limit) };
};

export const removeSuppressedAddress = async (email: string) => {
  await SuppressedAddress.deleteOne({ email });
  return { message: `${email} removed from suppression list` };
};