import { Request, Response } from 'express';
import { Invoice } from '../models/Invoice';
import { PtpService } from '../services/ptpServices';

export const createInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { invoiceId, clientName, clientEmail, clientPhone, amount, dueDate } = req.body;

    const invoice = await Invoice.create({
      invoiceId,
      clientName,
      clientEmail,
      clientPhone,
      amount,
      dueDate: new Date(dueDate),
      status: 'OVERDUE',
      escalationLevel: 1,
    });

    res.status(201).json({ status: 'created', invoice });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const handlePtpNegotiation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { invoiceId, message } = req.body;
    if (!invoiceId || !message) {
      res.status(400).json({ error: 'invoiceId and message are required' });
      return;
    }

    const result = await PtpService.processClientReply(invoiceId, message);
    res.status(200).json({ status: 'success', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const checkBrokenPromises = async (_req: Request, res: Response): Promise<void> => {
  try {
    const brokenCount = await PtpService.reconcileBrokenPromises();
    res.status(200).json({ status: 'reconciled', brokenPromisesFound: brokenCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};