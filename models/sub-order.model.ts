import mongoose, { Schema } from "mongoose";

// interfaces
import { ISubOrder } from "@/interfaces/isub-order.interfaces";

const SubOrderSchema = new Schema<ISubOrder>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderCode: { type: String, required: true },
    buyerId: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
    },
    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product" },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
        size: { type: String, default: "Mặc định" },
        image: { type: String },
      },
    ],

    financials: {
      shopSubTotal: { type: Number, required: true },
      shippingFee: { type: Number, required: true },
      shippingDiscount: { type: Number, default: 0 },
      finalShippingFee: { type: Number, required: true },
    },

    shippingMethod: { type: String, required: true },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PREPARING",
        "SHIPPING",
        "DELIVERED",
        "CANCELLED",
        "RETURNED",
      ],
      default: "PENDING",
    },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true },
);

SubOrderSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
SubOrderSchema.index({ buyerId: 1, status: 1, createdAt: -1 });
SubOrderSchema.index({ orderCode: 1 });

const SubOrder = mongoose.model<ISubOrder>(
  "SubOrder",
  SubOrderSchema,
  "sub-orders",
);

export default SubOrder;
