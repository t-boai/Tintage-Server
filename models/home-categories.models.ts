import mongoose, { Schema } from "mongoose";

// slug
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

// interface
import { ICategories } from "@/interfaces/ihome-categories";

const schema = new Schema<ICategories>(
  {
    name: {
      type: String,
      required: [true, "Vui lòng nhập tên danh mục"],
      trim: true,
      maxLength: [100, "Tên danh mục không vượt quá 100 ký tự"],
    },
    slug: {
      type: String,
      slug: "name",
      unique: true,
      lowercase: true,
      index: true,
    },
    image: {
      type: String,
      required: [true, "Vui lòng cung cấp hình ảnh danh mục"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxLength: [500, "Mô tả không vượt quá 500 ký tự"],
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null, // Danh mục cha/con chuẩn relational (dùng ObjectId thay vì String)
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
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

// HIGH TRAFFIC COMPOUND INDEXING
schema.index({ deleted: 1, isActive: 1, isFeatured: 1, order: 1 });

const HomeCategories = mongoose.model<ICategories>(
  "Category",
  schema,
  "home-categories",
);

export default HomeCategories;
