"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const invoiceController_1 = require("../controllers/invoiceController");
const router = (0, express_1.Router)();
router.post('/create', invoiceController_1.createInvoice);
router.post('/negotiate-ptp', invoiceController_1.handlePtpNegotiation);
router.post('/reconcile-broken', invoiceController_1.checkBrokenPromises);
exports.default = router;
