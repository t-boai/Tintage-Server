import mongoose, { Schema, Document } from "mongoose";

// interface
import { IHeaert } from "@/interfaces/ihearts.interfaces";

const schema = new Schema<IHeaert>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
      index: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Đảm bảo 1 User chỉ thả tim 1 Product đúng 1 lần (unique: true)
// Query kiểm tra User đã tim Product này chưa mất 0.1ms
schema.index({ user: 1, product: 1 }, { unique: true });

const Heart = mongoose.model<IHeaert>("Heart", schema, "hearts");

export default Heart;
