import mongoose, { Schema } from "mongoose";

// interfaces
import { IPaymentTransaction } from "@/interfaces/ipayment-transaction.interfaces";

const PaymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderCode: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "AccountUser", required: true },
    provider: {
      type: String,
      enum: ["COD", "MOMO", "VNPAY", "CREDIT_CARD"],
      required: true,
    },
    transactionId: { type: String, default: "" },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED"],
      default: "PENDING",
    },
    gatewayResponse: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

PaymentTransactionSchema.index(
  { transactionId: 1 },
  { partialFilterExpression: { transactionId: { $type: "string" } } },
);
PaymentTransactionSchema.index({ orderCode: 1, createdAt: -1 });

const PaymentTransaction = mongoose.model<IPaymentTransaction>(
  "PaymentTransaction",
  PaymentTransactionSchema,
  "payment-transactions",
);

export default PaymentTransaction;
