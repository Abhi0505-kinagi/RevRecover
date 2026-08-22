"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const checkoutController_1 = require("../controllers/checkoutController");
const router = (0, express_1.Router)();
router.get('/health-check', checkoutController_1.getPaymentOptionsHealth);
router.post('/simulate-drop', checkoutController_1.simulateBankFailure);
exports.default = router;
