import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import webhookRoutes from './routes/webhookRoutes';
import checkoutRoutes from './routes/checkoutRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import metricsRoutes from './routes/metricsRoutes';
import './config/redis';
import './queues/recoveryQueues';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use('/api/webhooks', webhookRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/metrics', metricsRoutes);
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 AI Revenue Recovery Engine running on port ${PORT}`);
  });
};

startServer();