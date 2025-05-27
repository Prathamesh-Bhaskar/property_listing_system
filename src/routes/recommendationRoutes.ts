import { Router } from 'express';
import { recommendationController } from '../controllers/recommendationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/send', recommendationController.send);
router.get('/received', recommendationController.getReceived);
router.get('/sent', recommendationController.getSent);
router.patch('/:id/read', recommendationController.markAsRead);
router.get('/users/search', recommendationController.searchUsers);

export default router;