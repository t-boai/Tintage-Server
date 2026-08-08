import mongoose from "mongoose";

// interface
import { IButton } from "@/interfaces/ibutton.interfaces";
import { IHomeSlide } from "@/interfaces/ihome-slides.interfaces";

const buttonSchema = new mongoose.Schema<IButton>(
  {
    text: {
      type: String,
      required: [true, "Vui lòng nhập nội dung nút"],
      trim: true,
      maxLength: [20, "Nội dung nút không quá 20 ký tự"],
    },
    href: {
      type: String,
      required: [true, "Vui lòng nhập đường dẫn (href)"],
      trim: true,
    },
  },
  { _id: false },
);

const schema = new mongoose.Schema<IHomeSlide>(
  {
    badge: {
      type: String,
      trim: true,
      default: "",
      maxLength: [50, "Badge không quá 50 ký tự"],
    },
    titleLine1: {
      type: String,
      trim: true,
      required: [true, "Vui lòng nhập tiêu đề dòng 1"],
      maxLength: [100, "Tiêu đề dòng 1 không quá 100 ký tự"],
    },
    titleLine2: {
      type: String,
      trim: true,
      default: "",
      maxLength: [100, "Tiêu đề dòng 2 không quá 100 ký tự"],
    },
    description: {
      type: String,
      required: [true, "Vui lòng nhập mô tả"],
      trim: true,
      maxLength: [500, "Mô tả không quá 500 ký tự"],
    },
    primaryBtn: {
      type: buttonSchema,
      required: [true, "Vui lòng cấu hình nút bấm chính"],
    },
    secondaryBtn: {
      type: buttonSchema,
      default: null,
    },
    image: {
      type: String,
      required: [true, "Vui lòng cung cấp URL ảnh"],
      trim: true,
    },
    alt: {
      type: String,
      required: [true, "Vui lòng cung cấp thẻ alt cho ảnh"],
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Tối ưu tốc độ query theo trạng thái và thứ tự hiển thị
schema.index({ deleted: 1, isActive: 1, order: 1, createdAt: -1 });

const Slide = mongoose.model("HomeSlide", schema, "home-slide");

export default Slide;
