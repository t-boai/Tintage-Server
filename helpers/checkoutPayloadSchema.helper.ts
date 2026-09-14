import { z } from "zod";
import mongoose from "mongoose";

export const checkoutPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z
          .string()
          .refine((val) => mongoose.Types.ObjectId.isValid(val), {
            message: "Mã sản phẩm không hợp lệ",
          }),
        quantity: z
          .number()
          .int()
          .positive({ message: "Số lượng phải là số nguyên dương" }),
      }),
    )
    .min(1, { message: "Giỏ hàng rỗng" })
    .max(50, { message: "Vượt quá giới hạn sản phẩm mỗi lần thanh toán" }),
});
