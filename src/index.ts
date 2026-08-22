import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import './config/redis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

// Raw buffer parsing required for Razorpay Webhook HMAC verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

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