"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/razorpay_recovery';
        await mongoose_1.default.connect(mongoUri);
        console.log('MongoDB connected successfully.');
    }
    catch (error) {
        console.error(' MongoDB Connection Error:', error);
        process.exit(1);
    }
};
exports.connectDB = connectDB;
