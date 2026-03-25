import { EmailLog } from "../../models/Emaillog";
import { SuppressedAddress } from "../../models/Suppressedaddress";

export const parseSNSBody = (body: any): any => {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body ?? null;
};

export const handleSNSMessage = async (snsMessage: any) => {
  if (!snsMessage) throw new Error('Invalid SNS message');

  // Subscription confirmation
  if (snsMessage.Type === 'SubscriptionConfirmation') {
    console.log('[SNS] Subscription confirmation URL:', snsMessage.SubscribeURL);
    return { type: 'subscription', message: 'Confirmation URL logged' };
  }

  // Only process notifications
  if (snsMessage.Type !== 'Notification') {
    return { type: 'ignored', message: 'Ignored non-notification message' };
  }

  const notification = JSON.parse(snsMessage.Message);
  const notifType: string = notification.notificationType;

  if (notifType === 'Bounce') await handleBounce(notification);
  else if (notifType === 'Complaint') await handleComplaint(notification);

  return { type: 'notification', message: 'Processed' };
};

const handleBounce = async (notification: any) => {
  const bouncedRecipients = notification.bounce?.bouncedRecipients ?? [];
  for (const recipient of bouncedRecipients) {
    const email = recipient.emailAddress.toLowerCase();
    await SuppressedAddress.findOneAndUpdate(
      { email },
      { email, reason: 'bounce' },
      { upsert: true, new: true }
    );
    await EmailLog.updateMany(
      { to: email },
      { $set: { bouncedAt: new Date() } }
    );
    console.log(`[SNS] Bounce recorded for ${email}`);
  }
};

const handleComplaint = async (notification: any) => {
  const complainedRecipients = notification.complaint?.complainedRecipients ?? [];
  for (const recipient of complainedRecipients) {
    const email = recipient.emailAddress.toLowerCase();
    await SuppressedAddress.findOneAndUpdate(
      { email },
      { email, reason: 'complaint' },
      { upsert: true, new: true }
    );
    await EmailLog.updateMany(
      { to: email },
      { $set: { complaintAt: new Date() } }
    );
    console.log(`[SNS] Complaint recorded for ${email}`);
  }
};