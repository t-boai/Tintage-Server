import { Document } from "mongoose";

//interface
import { IButton } from "@/interfaces/ibutton.interfaces";

export interface IHomeSlide extends Document {
  badge?: string;
  titleLine1: string;
  titleLine2?: string;
  description: string;
  primaryBtn: IButton;
  secondaryBtn?: IButton | null;
  image: string;
  alt: string;
  order: number;
  isActive: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}
