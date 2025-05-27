import { Router } from 'express';
import { propertyController } from '../controllers/propertyController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/', propertyController.getAll);
router.get('/:id', propertyController.getById);

// Protected routes
router.use(authenticate);
router.post('/', propertyController.create);
router.put('/:id', propertyController.update);
router.delete('/:id', propertyController.delete);
router.get('/user/my-properties', propertyController.getMyProperties);

export default router;