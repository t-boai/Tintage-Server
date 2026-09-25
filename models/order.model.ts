import mongoose, { Schema, Document } from "mongoose";

// interfaces
import { IOrder } from "@/interfaces/iorder.interfaces";

const OrderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "AccountUser", required: true },
    orderCode: { type: String, required: true, trim: true },
    paymentMethod: {
      type: String,
      enum: ["COD", "MOMO", "VNPAY", "CREDIT_CARD"],
      required: true,
    },
    grandTotal: { type: Number, required: true, min: 0 },
    shippingAddress: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["PENDING_PAYMENT", "PROCESSING", "CANCELLED"],
      default: "PROCESSING",
    },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true },
);

OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ orderCode: 1 }, { unique: true });

const Order = mongoose.model<IOrder>("Order", OrderSchema, "orders");

export default Order;
