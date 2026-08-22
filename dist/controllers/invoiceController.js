"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBrokenPromises = exports.handlePtpNegotiation = exports.createInvoice = void 0;
const Invoice_1 = require("../models/Invoice");
const ptpServices_1 = require("../services/ptpServices");
const createInvoice = async (req, res) => {
    try {
        const { invoiceId, clientName, clientEmail, clientPhone, amount, dueDate } = req.body;
        const invoice = await Invoice_1.Invoice.create({
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.createInvoice = createInvoice;
const handlePtpNegotiation = async (req, res) => {
    try {
        const { invoiceId, message } = req.body;
        if (!invoiceId || !message) {
            res.status(400).json({ error: 'invoiceId and message are required' });
            return;
        }
        const result = await ptpServices_1.PtpService.processClientReply(invoiceId, message);
        res.status(200).json({ status: 'success', data: result });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.handlePtpNegotiation = handlePtpNegotiation;
const checkBrokenPromises = async (_req, res) => {
    try {
        const brokenCount = await ptpServices_1.PtpService.reconcileBrokenPromises();
        res.status(200).json({ status: 'reconciled', brokenPromisesFound: brokenCount });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.checkBrokenPromises = checkBrokenPromises;
