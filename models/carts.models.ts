import mongoose, { Schema } from "mongoose";

// interfaces
import { ICart, ICartItem } from "@/interfaces/icarts.interfaces";

const cartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Số lượng tối thiểu là 1"],
    },
  },
  { _id: false },
);

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
      unique: true, // 1 User chỉ có duy nhất 1 Giỏ hàng
    },
    items: [cartItemSchema],
  },
  { timestamps: true },
);

const Cart = mongoose.model<ICart>("Cart", cartSchema, "carts");

export default Cart;
