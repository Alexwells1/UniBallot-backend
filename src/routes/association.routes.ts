import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createAssociation, associationSchema,
  listAssociations,
  getAssociation,
  updateAssociation,
  deleteAssociation,
} from '../controllers/association.controller';

const router = Router();

router.use(authenticate, authorize('super_admin'));

router.post('/',    validate(associationSchema), createAssociation);
router.get('/',     listAssociations);
router.get('/:id',  getAssociation);
router.patch('/:id', updateAssociation);
router.delete('/:id', deleteAssociation);

export default router;
