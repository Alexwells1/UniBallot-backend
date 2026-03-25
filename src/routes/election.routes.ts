import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { authorizeElection } from "../middleware/authorizeElection";
import { validate } from "../middleware/validate";
import { uploadCsv } from "../middleware/upload";
import { votingLimiter, receiptLimiter } from "../middleware/rateLimiter";

import {
  createElection,
  createElectionSchema,
  listElections,
  getElection,
  getElectionByCode,
  updateElection,
  deleteElection,
  transitionStatus,
  toggleLockdown,
  registerForElection,
  getAnalytics,
  publishResults,
  getResults,
  previewResults,
  getResultsByCode,
  listMyElections,
  getOpenElections,
} from "../controllers/election.controller";

import {
  uploadMembers,
  listMembers,
  clearMembers,
  getMember,
  updateMember,
  deleteMember,
} from "../controllers/member.controller";
import {
  createOffice,
  officeSchema,
  listOffices,
  updateOffice,
  deleteOffice,
} from "../controllers/office.controller";
import {
  getBallotHandler,
  submitBallotHandler,
  verifyReceipt,
  integrityCheck,
  voteSubmissionSchema,
} from "../controllers/voting.controller";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: static-segment routes MUST come before parameterised /:id routes.
// "code", "register" would otherwise match as an :id value.
// ─────────────────────────────────────────────────────────────────────────────

// ── Public — no auth ──────────────────────────────────────────────────────────
router.get("/code/:code", getElectionByCode);
router.get(
  "/code/:code/results",
  authenticate,
  authorize("super_admin", "student"),
  getResultsByCode,
);

// ── Student: self-register ────────────────────────────────────────────────────
router.post(
  "/register",
  authenticate,
  authorize("student"),
  validate(z.object({ electionCode: z.string().min(1) })),
  registerForElection,
);

// ── SA: create / list elections ───────────────────────────────────────────────
router.post(
  "/",
  authenticate,
  authorize("super_admin"),
  validate(createElectionSchema),
  createElection,
);
router.get(
  "/",
  authenticate,
  authorize("super_admin", "officer"),
  listElections,
);

router.get("/open", getOpenElections);

router.get("/my", authenticate, authorize("student"), listMyElections);

// Public receipt check — rate-limited to prevent receipt code enumeration
router.get("/:id/receipt/:code", receiptLimiter, verifyReceipt);

// Election CRUD
router.get(
  "/:id",
  authenticate,
  authorizeElection, // SA or assigned officer only
  getElection,
);

router.patch("/:id", authenticate, authorize("super_admin"), updateElection);

router.delete(
  "/:id",
  authenticate,
  authorize("super_admin"),
  validate(z.object({ force: z.boolean().optional() })),
  deleteElection,
);

// Lifecycle
router.patch(
  "/:id/status",
  authenticate,
  authorizeElection,
  validate(z.object({ status: z.string().min(1) })),
  transitionStatus,
);
router.post(
  "/:id/lockdown",
  authenticate,
  authorize("super_admin"),
  validate(z.object({ active: z.boolean() })),
  toggleLockdown,
);





router.get(
  "/:id/members/:memberId",
  authenticate,
  authorizeElection,
  getMember,
);
router.patch(
  "/:id/members/:memberId",
  authenticate,
  authorizeElection,
  updateMember,
);
router.delete(
  "/:id/members/:memberId",
  authenticate,
  authorizeElection,
  deleteMember,
);

router.post(
  "/:id/members",
  authenticate,
  authorizeElection,
  uploadCsv,
  uploadMembers,
);
router.get("/:id/members", authenticate, authorizeElection, listMembers);
router.delete(
  "/:id/members",
  authenticate,
  authorize("super_admin"),
  clearMembers,
);

// Offices
router.post(
  "/:id/offices",
  authenticate,
  authorizeElection,
  validate(officeSchema),
  createOffice,
);
router.get("/:id/offices", authenticate, authorizeElection, listOffices);
router.patch(
  "/:id/offices/:officeId",
  authenticate,
  authorizeElection,
  updateOffice,
);
router.delete(
  "/:id/offices/:officeId",
  authenticate,
  authorizeElection,
  deleteOffice,
);

// Voting (students only)
router.get("/:id/ballot", authenticate, authorize("student"), getBallotHandler);
router.post(
  "/:id/vote",
  authenticate,
  authorize("student"),
  votingLimiter,
  validate(voteSubmissionSchema),
  submitBallotHandler,
);

// Results — /preview BEFORE /results to avoid shadowing
router.get(
  "/:id/results/preview",
  authenticate,
  authorizeElection,
  previewResults,
);
router.get(
  "/:id/results",
  authenticate,
  authorize("super_admin", "student"),
  getResults,
);
router.post(
  "/:id/publish-results",
  authenticate,
  authorizeElection,
  publishResults,
);

// Analytics & integrity
router.get("/:id/analytics", authenticate, authorizeElection, getAnalytics);
router.get(
  "/:id/integrity-check",
  authenticate,
  authorize("super_admin"),
  integrityCheck,
);

export default router;
