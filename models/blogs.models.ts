import mongoose, { Schema } from "mongoose";

// interfaces
import { IBlog } from "@/interfaces/iblog.interfaces";

const schema = new Schema<IBlog>(
  {
    title: {
      type: String,
      required: [true, "Tiêu đề bài viết không được để trống"],
      trim: true,
      maxLength: [200, "Tiêu đề không quá 200 ký tự"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      required: [true, "Chuyên mục không được để trống"],
      trim: true,
      uppercase: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, "Mô tả ngắn không được để trống"],
      trim: true,
      maxLength: [500, "Mô tả không quá 500 ký tự"],
    },
    content: {
      type: String,
      required: [true, "Nội dung bài viết không được để trống"],
    },
    image: {
      type: String,
      required: [true, "Hình ảnh đại diện không được để trống"],
    },
    readTime: {
      type: Number,
      default: 5,
      min: 1,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
    },
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

schema.index({
  deleted: 1,
  isActive: 1,
  publishedAt: -1,
  createdAt: -1,
});

const Blog = mongoose.model<IBlog>("Blog", schema, "blogs");

export default Blog;
