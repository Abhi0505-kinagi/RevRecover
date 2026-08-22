import { Router } from 'express';
import { createInvoice, handlePtpNegotiation, checkBrokenPromises } from '../controllers/invoiceController';

const router = Router();

router.post('/create', createInvoice);
router.post('/negotiate-ptp', handlePtpNegotiation);
router.post('/reconcile-broken', checkBrokenPromises);

export default router;