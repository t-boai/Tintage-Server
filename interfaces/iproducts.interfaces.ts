import mongoose, { Document } from "mongoose";

export interface IProductImage {
  url: string;
  publicId: string;
}

export interface IProduct extends Document {
  brand: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  condition?: number;
  size?: string;
  images: IProductImage[];
  category: mongoose.Types.ObjectId;
  seller: mongoose.Types.ObjectId;
  location: string;
  description?: string;
  material?: string;
  colors: string[];
  gender: "men" | "women" | "unisex" | "kids";
  isNewProduct: boolean;
  isFeatured: boolean;
  isActive: boolean;
  order: number;
  stock: number;
  randomSeed: number;
  viewsCount: number;
  likesCount: number;
  salesCount: number;
  discount: number;
  hotScore: number;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
