import mongoose from "mongoose";

// interface
import { IAccountUser } from "@/interfaces/iaccount-user.interfaces";

const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

const schema = new mongoose.Schema<IAccountUser>(
  {
    fullName: {
      type: String,
      required: [true, "Vui lòng nhập họ và tên"],
      trim: true,
      maxLength: [100, "Họ tên không vượt quá 100 ký tự"],
    },
    email: {
      type: String,
      required: [true, "Vui lòng nhập email"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      slug: "fullName",
      unique: true,
      sparse: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, "Vui lòng nhập mật khẩu"],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    avatar: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    refreshToken: {
      type: String,
      default: "",
      select: false, // Ẩn refreshToken khỏi các query thông thường
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    isVerifiedSeller: {
      type: Boolean,
      default: false,
      index: true,
    },
    sellerRole: {
      type: String,
      enum: ["individual", "pro", "mall"],
      default: "individual",
      index: true,
    },
    sellerRating: {
      type: Number,
      default: 5.0,
      min: [0, "Rating không thể nhỏ hơn 0"],
      max: [5, "Rating tối đa là 5.0"],
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

schema.index({ email: 1, deleted: 1, isActive: 1 });
schema.index({ isVerifiedSeller: 1, sellerRole: 1 });
schema.index({ slug: 1, deleted: 1, isActive: 1 });

const AccountUser = mongoose.model<IAccountUser>(
  "AccountUser",
  schema,
  "users",
);

export default AccountUser;
