import mongoose, { Schema, Document } from "mongoose";

// interface
import { IProduct } from "@/interfaces/iproducts.interfaces";

// slug
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

const schema = new Schema<IProduct>(
  {
    brand: {
      type: String,
      required: [true, "Vui lòng nhập tên thương hiệu"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Vui lòng nhập tên sản phẩm"],
      trim: true,
      maxLength: [200, "Tên sản phẩm không quá 200 ký tự"],
    },
    slug: {
      type: String,
      slug: "name",
      unique: true,
      lowercase: true,
      index: true,
    },
    price: {
      type: Number,
      required: [true, "Vui lòng nhập giá bán"],
      min: [0, "Giá bán không thể nhỏ hơn 0"],
      index: true,
    },
    originalPrice: {
      type: Number,
      default: 0,
    },
    condition: {
      type: Number,
      min: [0, "Độ mới tối thiểu là 0%"],
      max: [100, "Độ mới tối đa là 100%"],
      default: 100,
    },
    size: {
      type: String,
      trim: true,
      default: "",
    },
    images: {
      type: [String],
      required: [true, "Vui lòng cung cấp ít nhất 1 hình ảnh"],
      validate: {
        validator: (val: string[]) => val.length > 0,
        message: "Sản phẩm phải có ít nhất 1 hình ảnh",
      },
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Sản phẩm phải thuộc một danh mục"],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    isNewProduct: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      default: 1,
    },
    viewsCount: {
      type: Number,
      default: 0,
    },
    likesCount: {
      type: Number,
      default: 0,
    },
    salesCount: {
      type: Number,
      default: 0,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// 1. Phủ Query Lọc & Sắp xếp theo Danh mục
schema.index({ category: 1, deleted: 1, isActive: 1, createdAt: -1 });

// 2. Phủ Query Lọc Trang chủ & Hot Score
schema.index({ deleted: 1, isActive: 1, isFeatured: -1, order: 1 });

const Product = mongoose.model<IProduct>("Product", schema, "products");

export default Product;
