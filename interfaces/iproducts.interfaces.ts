import mongoose, { Document } from "mongoose";

export interface IProduct extends Document {
  brand: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  condition?: number;
  size?: string;
  images: string[];
  category: mongoose.Types.ObjectId; // FK nối sang bảng Category
  description?: string;
  isNewProduct: boolean;
  isFeatured: boolean;
  isActive: boolean;
  order: number;
  stock: number;
  viewsCount: number;
  likesCount: number;
  salesCount: number;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
