import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorizeElection } from '../middleware/authorizeElection';
import { validate } from '../middleware/validate';
import { uploadPhoto } from '../middleware/upload';
import {
  addCandidate,   candidateSchema,
  listCandidates,
  updateCandidate,
  deleteCandidate,
} from '../controllers/candidate.controller';

/**
 * Mounted at /api/offices.
 * authorizeElection resolves the election via Office.electionId when
 * req.params.officeId is present (no req.params.id on these routes).
 */
const router = Router({ mergeParams: true });

router.post(
  '/:officeId/candidates',
  authenticate,
  authorizeElection,
  uploadPhoto,
  validate(candidateSchema),
  addCandidate
);

router.get(
  '/:officeId/candidates',
  authenticate,
  authorizeElection,
  listCandidates
);

router.patch(
  '/:officeId/candidates/:candidateId',
  authenticate,
  authorizeElection,
  uploadPhoto,
  updateCandidate
);

router.delete(
  '/:officeId/candidates/:candidateId',
  authenticate,
  authorizeElection,
  deleteCandidate
);

export default router;
