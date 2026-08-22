"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const webhookControllers_1 = require("../controllers/webhookControllers");
const verifyWebhook_1 = require("../middleware/verifyWebhook");
const router = (0, express_1.Router)();
router.post('/razorpay', verifyWebhook_1.verifyWebhookSignature, verifyWebhook_1.idempotencyGuard, webhookControllers_1.handleRazorpayWebhook);
exports.default = router;
