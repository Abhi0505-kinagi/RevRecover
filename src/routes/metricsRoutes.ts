import { Router } from 'express';
import { getSystemMetrics } from '../controllers/matricsController';

const router = Router();

router.get('/', getSystemMetrics);

export default router;