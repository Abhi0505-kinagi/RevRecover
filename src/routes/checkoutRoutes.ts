import { Router } from 'express';
import { getPaymentOptionsHealth, simulateBankFailure } from '../controllers/checkoutController';

const router = Router();

router.get('/health-check', getPaymentOptionsHealth);
router.post('/simulate-drop', simulateBankFailure);

export default router;