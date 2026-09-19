// z
import z from "zod";

export const addAddressSchema = z.object({
  fullName: z.string().trim().min(2, "Tên quá ngắn").max(50, "Tên quá dài"),
  phone: z
    .string()
    .trim()
    .regex(/^0[35789][0-9]{8}$/, "Số điện thoại không hợp lệ (10 chữ số)"),
  province: z.string().trim().min(1, "Vui lòng chọn Tỉnh/Thành phố"),
  district: z.string().trim().min(1, "Vui lòng chọn Quận/Huyện"),
  ward: z.string().trim().min(1, "Vui lòng chọn Phường/Xã"),
  street: z.string().trim().min(5, "Địa chỉ cụ thể quá ngắn").max(100),
  isDefault: z.boolean().optional().default(false),
  fullAddress: z.string().trim().min(5, "Địa chỉ đầy đủ không hợp lệ"),
});
