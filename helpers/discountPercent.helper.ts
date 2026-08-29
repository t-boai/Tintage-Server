export const DiscountPercent = (
  price?: number,
  originalPrice?: number,
): number => {
  // Nếu không có giá gốc hoặc giá gốc <= giá bán hiện tại -> Không giảm giá
  if (!originalPrice || !price || originalPrice <= price) {
    return 0;
  }

  const discount = Math.round(((originalPrice - price) / originalPrice) * 100);

  return Math.min(Math.max(discount, 1), 99);
};
