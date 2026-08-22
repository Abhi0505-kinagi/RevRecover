import { Router } from 'express';
import { handleRazorpayWebhook } from '../controllers/webhookControllers';
import { verifyWebhookSignature, idempotencyGuard } from '../middleware/verifyWebhook';

const router = Router();

router.post('/razorpay', verifyWebhookSignature, idempotencyGuard, handleRazorpayWebhook);

export default router;