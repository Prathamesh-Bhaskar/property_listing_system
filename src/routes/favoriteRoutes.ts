import { Router } from 'express';
import { favoriteController } from '../controllers/favoriteController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/', favoriteController.add);
router.delete('/:propertyId', favoriteController.remove);
router.get('/', favoriteController.getAll);

export default router;