import mongoose, { Document } from "mongoose";

export interface ISubOrder extends Document {
  orderId: mongoose.Types.ObjectId;
  orderCode: string;
  buyerId: mongoose.Types.ObjectId;
  sellerId: mongoose.Types.ObjectId;
  items: {
    productId: mongoose.Types.ObjectId;
    name: string;
    price: number;
    quantity: number;
    size: string;
    image: string;
  }[];
  financials: {
    shopSubTotal: number;
    shippingFee: number;
    shippingDiscount: number;
    finalShippingFee: number;
  };
  shippingMethod: string;
  note: string;
  status:
    | "PENDING"
    | "PREPARING"
    | "SHIPPING"
    | "DELIVERED"
    | "CANCELLED"
    | "RETURNED";
  cancelReason?: string;
}
