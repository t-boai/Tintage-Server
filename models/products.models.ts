import mongoose, { Schema } from "mongoose";

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
      sparse: true,
      index: true,
    },
    material: { type: String, default: "" },
    colors: {
      type: [String],
      default: [],
      index: true,
    },
    gender: {
      type: String,
      enum: ["men", "women", "unisex", "kids"],
      default: "unisex",
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
    seller: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: [true, "Sản phẩm phải có người bán"],
      index: true,
    },
    location: {
      type: String,
      required: [true, "Vui lòng cung cấp khu vực bán (VD: Hà Nội, TP.HCM)"],
      trim: true,
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
    discount: {
      type: Number,
      default: 0,
    },
    randomSeed: {
      type: Number,
      default: () => Math.random(),
      index: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

schema.pre("save", async function () {
  if (this.isModified("price") || this.isModified("originalPrice")) {
    if (this.originalPrice && this.originalPrice > this.price) {
      this.discount = Math.round(
        ((this.originalPrice - this.price) / this.originalPrice) * 100,
      );
    } else {
      this.discount = 0;
    }
  }
});

// text index cho tính năng Search Keyword
schema.index(
  { name: "text", brand: "text", description: "text" },
  {
    weights: { name: 10, brand: 5, description: 1 },
    name: "ProductTextIndex",
  },
);

// 1. Phủ Query Lọc Danh mục kết hợp Giới tính
schema.index({
  category: 1,
  gender: 1,
  deleted: 1,
  isActive: 1,
  createdAt: -1,
});

// 2. Phủ Query Lọc Trang chủ và Thứ tự ưu tiên
schema.index({ deleted: 1, isActive: 1, isFeatured: -1, order: 1 });

// 3. Tối ưu C2C: Truy vấn sản phẩm của 1 Shop
schema.index({ seller: 1, deleted: 1, isActive: 1, createdAt: -1 });

// 4. Tối ưu C2C: Lọc theo khu vực quanh đây
schema.index({ location: 1, category: 1, deleted: 1, isActive: 1 });

// 5. Index cho bộ lọc Flash Sale / Giảm giá sâu
schema.index({ discount: -1, deleted: 1, isActive: 1 });

// 6. Index cho phân trang ngẫu nhiên
schema.index({ randomSeed: 1, deleted: 1, isActive: 1 });

const Product = mongoose.model<IProduct>("Product", schema, "products");

export default Product;
