import mongoose, { Document } from "mongoose";

export interface ICategoryAncestor {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
}

export interface ICategories extends Document {
  name: string;
  slug: string;
  image: string;
  description?: string;
  parentId?: mongoose.Types.ObjectId | null;
  ancestors: ICategoryAncestor[];
  order: number;
  isActive: boolean;
  isFeatured: boolean;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
