import mongoose, { Document } from "mongoose";

export interface IHeaert extends Document {
  user: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId;
  createdAt: Date;
}
