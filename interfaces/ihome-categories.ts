import mongoose, { Document } from "mongoose";

export interface ICategories extends Document {
  name: string;
  slug: string;
  image: string;
  description?: string;
  parentId?: mongoose.Types.ObjectId | null;
  order: number;
  isActive: boolean;
  isFeatured: boolean;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
