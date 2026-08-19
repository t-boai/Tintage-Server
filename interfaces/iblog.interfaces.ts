import { Document, Types } from "mongoose";

export interface IBlog extends Document {
  title: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  image: string;
  readTime: number;
  author: Types.ObjectId;
  viewsCount: number;
  isFeatured: boolean;
  isActive: boolean;
  deleted: boolean;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
