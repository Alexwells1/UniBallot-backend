export function otpEmailTemplate(code: string): { subject: string; html: string } {
  return {
    subject: 'Your Verification Code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Email Verification</h2>
        <p>Your one-time verification code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1d4ed8;
                    padding:16px;background:#f0f4ff;border-radius:6px;text-align:center">
          ${code}
        </div>
        <p style="color:#6b7280;font-size:13px">
          This code expires in 10 minutes. Do not share it with anyone.
        </p>
      </div>
    `,
  };
}

export function passwordResetNotificationTemplate(
  fullName: string
): { subject: string; html: string } {
  return {
    subject: 'Your Password Has Been Reset',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Password Reset</h2>
        <p>Hi ${fullName},</p>
        <p>Your account password has been reset by an administrator.
           You will be prompted to change your password on next login.</p>
        <p style="color:#6b7280;font-size:13px">
          If you did not expect this, contact support immediately.
        </p>
      </div>
    `,
  };
}

export function accountSuspendedTemplate(
  fullName: string
): { subject: string; html: string } {
  return {
    subject: 'Your Account Has Been Suspended',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;
                  border:1px solid #fef2f2;border-radius:8px">
        <h2 style="color:#dc2626">Account Suspended</h2>
        <p>Hi ${fullName},</p>
        <p>Your account has been temporarily suspended.
           Contact your administrator for more information.</p>
      </div>
    `,
  };
}

export function accountActivatedTemplate(
  fullName: string
): { subject: string; html: string } {
  return {
    subject: 'Your Account Has Been Reactivated',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#16a34a">Account Reactivated</h2>
        <p>Hi ${fullName},</p>
        <p>Your account has been reactivated. You can now log in.</p>
      </div>
    `,
  };
}