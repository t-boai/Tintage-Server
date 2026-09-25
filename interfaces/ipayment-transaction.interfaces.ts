import mongoose, { Document } from "mongoose";

export interface IPaymentTransaction extends Document {
  orderId: mongoose.Types.ObjectId;
  orderCode: string;
  userId: mongoose.Types.ObjectId;
  provider: "COD" | "MOMO" | "VNPAY" | "CREDIT_CARD";
  transactionId: string;
  amount: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  gatewayResponse: any;
}
