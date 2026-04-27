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
  fullName: string,
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
  fullName: string,
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
  fullName: string,
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

// ── NEW TEMPLATES ─────────────────────────────────────────────────────────────

/**
 * Sent to a newly created officer account.
 * Includes their temporary password so they can log in and change it.
 */
export function officerWelcomeTemplate(
  fullName: string,
  email: string,
  temporaryPassword: string,
): { subject: string; html: string } {
  return {
    subject: 'Your Officer Account Has Been Created',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Welcome, ${fullName}!</h2>
        <p>An officer account has been created for you on the election management platform.</p>
        <p>Here are your login credentials:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb;width:40%">Email</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${email}</td>
          </tr>
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb">Temporary Password</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:15px">${temporaryPassword}</td>
          </tr>
        </table>
        <p style="color:#dc2626;font-weight:bold">
          ⚠️ You are required to change your password after your first login.
        </p>
        <p style="color:#6b7280;font-size:13px">
          If you did not expect this email, please contact the system administrator immediately.
        </p>
      </div>
    `,
  };
}

/**
 * Sent to an officer when they are assigned to manage an election.
 */
export function officerElectionAssignedTemplate(
  fullName: string,
  electionTitle: string,
  electionCode: string,
): { subject: string; html: string } {
  return {
    subject: `You've Been Assigned to an Election: ${electionTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Election Assignment</h2>
        <p>Hi ${fullName},</p>
        <p>You have been assigned as the officer responsible for the following election:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb;width:40%">Election</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${electionTitle}</td>
          </tr>
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb">Election Code</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:15px">${electionCode}</td>
          </tr>
        </table>
        <p>Please log in to the platform to review the election and begin setup.</p>
        <p style="color:#6b7280;font-size:13px">
          If you believe this assignment is a mistake, contact the system administrator.
        </p>
      </div>
    `,
  };
}

/**
 * Sent to a student when they successfully register for an election.
 */
export function voterRegistrationConfirmationTemplate(
  fullName: string,
  electionTitle: string,
  electionCode: string,
): { subject: string; html: string } {
  return {
    subject: `You're Registered to Vote: ${electionTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Voter Registration Confirmed</h2>
        <p>Hi ${fullName},</p>
        <p>You have successfully registered to vote in the following election:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb;width:40%">Election</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${electionTitle}</td>
          </tr>
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb">Election Code</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:15px">${electionCode}</td>
          </tr>
        </table>
        <p>You will be able to cast your vote once the voting period opens.
           Watch out for further notifications.</p>
        <p style="color:#6b7280;font-size:13px">
          If you did not register for this election, contact your administrator immediately.
        </p>
      </div>
    `,
  };
}

/**
 * Sent to a student after they successfully submit their ballot.
 */
export function voteSubmittedConfirmationTemplate(
  fullName: string,
  electionTitle: string,
  receiptCode: string,
): { subject: string; html: string } {
  return {
    subject: `Vote Confirmed: ${electionTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#16a34a">Your Vote Has Been Recorded ✓</h2>
        <p>Hi ${fullName},</p>
        <p>Your ballot for <strong>${electionTitle}</strong> has been successfully submitted.</p>
        <p>Your receipt code is:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#1d4ed8;
                    padding:16px;background:#f0f4ff;border-radius:6px;text-align:center;
                    font-family:monospace">
          ${receiptCode}
        </div>
        <p style="color:#6b7280;font-size:13px;margin-top:16px">
          Keep this receipt code safe. You can use it to verify your vote was counted
          once results are published.
        </p>
        <p style="color:#6b7280;font-size:13px">
          Thank you for participating in your election.
        </p>
      </div>
    `,
  };
}

/**
 * Sent to the assigned officer when election results are published.
 */
export function resultsPublishedOfficerTemplate(
  fullName: string,
  electionTitle: string,
  electionCode: string,
  hasTies: boolean,
  tiedOffices: string[],
): { subject: string; html: string } {
  const tieWarning =
    hasTies
      ? `<p style="color:#b45309;background:#fffbeb;padding:12px;border-radius:6px;border:1px solid #fcd34d">
           ⚠️ <strong>Tie detected</strong> in the following office(s): ${tiedOffices.join(', ')}.
           Manual review may be required.
         </p>`
      : '';

  return {
    subject: `Results Published: ${electionTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;
                  border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8">Election Results Published</h2>
        <p>Hi ${fullName},</p>
        <p>The results for the election you managed have been officially published:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb;width:40%">Election</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${electionTitle}</td>
          </tr>
          <tr>
            <td style="padding:8px;background:#f9fafb;font-weight:bold;border:1px solid #e5e7eb">Election Code</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:15px">${electionCode}</td>
          </tr>
        </table>
        ${tieWarning}
        <p>Log in to the platform to view the full results breakdown.</p>
      </div>
    `,
  };
}