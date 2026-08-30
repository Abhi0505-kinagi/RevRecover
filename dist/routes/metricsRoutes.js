"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const matricsController_1 = require("../controllers/matricsController");
const router = (0, express_1.Router)();
router.get('/', matricsController_1.getSystemMetrics);
exports.default = router;
