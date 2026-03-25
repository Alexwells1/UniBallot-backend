import { Worker, Job } from "bullmq";
import { env } from "../../config/env";
import { EmailLog } from "../../models/Emaillog";
import { SuppressedAddress } from "../../models/Suppressedaddress";
import { EmailJobData, emailRetryQueue } from "./Emailqueue.service";
import { sendViaResend } from "./Resend.provider";
import { sendViaSES } from "./Sesprovider";
import type { ProviderSendOptions } from "./Sesprovider";
import { sendViaBrevo } from "./Brevoprovider";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [60_000, 180_000, 300_000];

const connection = {
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  password: env.REDIS_PASSWORD || undefined,
};

// ─── Provider pipeline ────────────────────────────────────────────────────────

interface Provider {
  name: string;
  fn: (opts: ProviderSendOptions) => Promise<void>;
}

const providers: Provider[] = [
  { name: "brevo", fn: sendViaBrevo },
  { name: "ses", fn: sendViaSES },
  { name: "resend", fn: sendViaResend },
];

// ─── Core send logic ──────────────────────────────────────────────────────────

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, html, jobId } = job.data;

  const log = await EmailLog.findOne({ jobId });

  if (!log) throw new Error(`EmailLog not found for jobId=${jobId}`);

  if (log.status === "sent") {
    console.log(`[worker] Job already sent | jobId=${jobId} | skipping`);
    return;
  }

  console.log(
    `[worker] ▶ Processing job | jobId=${jobId} | to=${to} | bullJobId=${job.id}`,
  );

  try {
    // 1. Suppression check
    console.log(`[worker] Checking suppression list for ${to}`);
    const suppressed = await SuppressedAddress.findOne({
      email: to.toLowerCase(),
    });

    if (suppressed) {
      console.warn(
        `[worker] ⛔ Address suppressed | email=${to} | reason=${suppressed.reason}`,
      );
      await EmailLog.findOneAndUpdate(
        { jobId },
        {
          status: "permanently_failed",
          failureType: "permanent",
          failureReason: `Address suppressed due to prior ${suppressed.reason}`,
        },
      );
      console.log(
        `[worker] EmailLog updated → permanently_failed (suppressed) | jobId=${jobId}`,
      );
      return;
    }

    console.log(`[worker] Address not suppressed, continuing | jobId=${jobId}`);

    // 2. Fetch and increment attempt count
    const log = await EmailLog.findOne({ jobId });

    if (!log) {
      console.error(`[worker] ❌ No EmailLog found for jobId=${jobId}`);
      throw new Error(`EmailLog not found for jobId=${jobId}`);
    }

    const currentAttempts = (log.attempts ?? 0) + 1;
    console.log(
      `[worker] Attempt ${currentAttempts}/${MAX_ATTEMPTS} | jobId=${jobId}`,
    );

    await EmailLog.findOneAndUpdate(
      { jobId },
      { attempts: currentAttempts, status: "retrying" },
    );

    // 3. Try each provider in order; stop on first success
    const opts: ProviderSendOptions = { to, subject, html };
    let allPermanent = true;
    let lastError: string | undefined;

    for (const provider of providers) {
      console.log(
        `[worker] Trying ${provider.name} | jobId=${jobId} | to=${to}`,
      );
      try {
        await provider.fn(opts);

        await EmailLog.findOneAndUpdate(
          { jobId },
          { status: "sent", provider: provider.name },
        );
        console.log(`[worker] ✅ Sent via ${provider.name} | jobId=${jobId}`);
        return; // success — exit immediately
      } catch (err: any) {
        console.warn(
          `[worker] ${provider.name} failed | jobId=${jobId} | isPermanent=${err.isPermanent} | error=${err.message}`,
        );
        lastError = `${provider.name}: ${err.message}`;

        if (!err.isPermanent) {
          // At least one provider had a temporary failure — don't mark all-permanent
          allPermanent = false;
        }
        // Always continue to the next provider
      }
    }

    // 4. All providers failed — decide retry vs permanent failure
    console.error(
      `[worker] ❌ All providers failed | jobId=${jobId} | allPermanent=${allPermanent}`,
    );

    if (allPermanent) {
      await EmailLog.findOneAndUpdate(
        { jobId },
        {
          status: "permanently_failed",
          failureType: "permanent",
          failureReason: `All providers permanently failed. Last error — ${lastError}`,
        },
      );
      console.log(
        `[worker] EmailLog updated → permanently_failed (all permanent) | jobId=${jobId}`,
      );
      return;
    }

    // Temporary failures — schedule retry if attempts remain
    await scheduleRetry(
      job.data,
      currentAttempts,
      `All providers temporarily failed. Last error — ${lastError}`,
    );
  } catch (unexpectedErr: any) {
    console.error(
      `[worker] 💥 Unexpected error | jobId=${jobId} | error=${unexpectedErr.message}`,
      unexpectedErr,
    );

    try {
      await EmailLog.findOneAndUpdate(
        { jobId },
        {
          status: "permanently_failed",
          failureType: "temporary",
          failureReason: `Unexpected worker error: ${unexpectedErr.message}`,
        },
      );
      console.log(
        `[worker] EmailLog updated → permanently_failed (unexpected crash) | jobId=${jobId}`,
      );
    } catch (dbErr: any) {
      console.error(
        `[worker] ⚠️ Could not update EmailLog after crash | jobId=${jobId} | dbErr=${dbErr.message}`,
      );
    }

    throw unexpectedErr; // re-throw so BullMQ marks the bull job as failed
  }
}

// ─── Retry scheduler ──────────────────────────────────────────────────────────

async function scheduleRetry(
  data: EmailJobData,
  currentAttempts: number,
  reason: string,
): Promise<void> {
  console.log(
    `[worker] scheduleRetry | jobId=${data.jobId} | currentAttempts=${currentAttempts} | reason=${reason}`,
  );

  if (currentAttempts >= MAX_ATTEMPTS) {
    console.warn(
      `[worker] Max retries reached (${MAX_ATTEMPTS}) | jobId=${data.jobId} → marking permanently_failed`,
    );
    await EmailLog.findOneAndUpdate(
      { jobId: data.jobId },
      {
        status: "permanently_failed",
        failureType: "temporary",
        failureReason: `Max retries (${MAX_ATTEMPTS}) reached. Last error: ${reason}`,
      },
    );
    console.log(
      `[worker] EmailLog updated → permanently_failed (max retries) | jobId=${data.jobId}`,
    );
    return;
  }

  const delay =
    RETRY_DELAYS[currentAttempts - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
  console.log(
    `[worker] Queuing retry | jobId=${data.jobId} | attempt=${currentAttempts + 1}/${MAX_ATTEMPTS} | delay=${delay}ms`,
  );

  await emailRetryQueue.add("retry-email", data, { delay });

  await EmailLog.findOneAndUpdate(
    { jobId: data.jobId },
    {
      status: "retrying",
      failureType: "temporary",
      failureReason: reason,
    },
  );
  console.log(`[worker] EmailLog updated → retrying | jobId=${data.jobId}`);
}

// ─── Main queue worker ────────────────────────────────────────────────────────

export const mainEmailWorker = new Worker<EmailJobData>(
  "email-main",
  processEmailJob,
  { connection, concurrency: 5 },
);

mainEmailWorker.on("ready", () =>
  console.log("[email-main] ✅ Worker connected to Redis and ready"),
);
mainEmailWorker.on("active", (job) =>
  console.log(
    `[email-main] 🔄 Job active | bullJobId=${job.id} | jobId=${job.data.jobId}`,
  ),
);
mainEmailWorker.on("completed", (job) =>
  console.log(
    `[email-main] ✅ Job completed | bullJobId=${job.id} | jobId=${job.data.jobId}`,
  ),
);
mainEmailWorker.on("failed", (job, err) =>
  console.error(
    `[email-main] ❌ Job crashed | bullJobId=${job?.id} | jobId=${job?.data?.jobId} | error=${err.message}`,
  ),
);
mainEmailWorker.on("error", (err) =>
  console.error("[email-main] Worker-level error (likely Redis):", err.message),
);
mainEmailWorker.on("stalled", (jobId) =>
  console.warn(`[email-main] ⚠️ Job stalled | bullJobId=${jobId}`),
);

// ─── Retry queue worker ───────────────────────────────────────────────────────

export const retryEmailWorker = new Worker<EmailJobData>(
  "email-retry",
  processEmailJob,
  { connection, concurrency: 3 },
);

retryEmailWorker.on("ready", () =>
  console.log("[email-retry] ✅ Worker connected to Redis and ready"),
);
retryEmailWorker.on("active", (job) =>
  console.log(
    `[email-retry] 🔄 Job active | bullJobId=${job.id} | jobId=${job.data.jobId}`,
  ),
);
retryEmailWorker.on("completed", (job) =>
  console.log(
    `[email-retry] ✅ Job completed | bullJobId=${job.id} | jobId=${job.data.jobId}`,
  ),
);
retryEmailWorker.on("failed", (job, err) =>
  console.error(
    `[email-retry] ❌ Job crashed | bullJobId=${job?.id} | jobId=${job?.data?.jobId} | error=${err.message}`,
  ),
);
retryEmailWorker.on("error", (err) =>
  console.error(
    "[email-retry] Worker-level error (likely Redis):",
    err.message,
  ),
);
retryEmailWorker.on("stalled", (jobId) =>
  console.warn(`[email-retry] ⚠️ Job stalled | bullJobId=${jobId}`),
);
