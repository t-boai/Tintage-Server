import mongoose, { Document } from "mongoose";

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  orderCode: string;
  paymentMethod: "COD" | "MOMO" | "VNPAY" | "CREDIT_CARD";
  grandTotal: number;
  shippingAddress: any;
  status: "PENDING_PAYMENT" | "PROCESSING" | "CANCELLED";
  cancelReason?: string;
  createdAt: Date;
}
