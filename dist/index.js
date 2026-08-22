"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const webhookRoutes_1 = __importDefault(require("./routes/webhookRoutes"));
const checkoutRoutes_1 = __importDefault(require("./routes/checkoutRoutes"));
const invoiceRoutes_1 = __importDefault(require("./routes/invoiceRoutes"));
require("./config/redis");
require("./queues/recoveryQueues");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
app.use('/api/webhooks', webhookRoutes_1.default);
app.use('/api/checkout', checkoutRoutes_1.default);
app.use('/api/invoices', invoiceRoutes_1.default);
app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
const startServer = async () => {
    await (0, db_1.connectDB)();
    app.listen(PORT, () => {
        console.log(`🚀 AI Revenue Recovery Engine running on port ${PORT}`);
    });
};
startServer();
