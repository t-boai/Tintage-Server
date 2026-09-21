import { ShippingOptionInfo } from "@/interfaces/ishipping.interfaces";
import { fetchShippingFee, cleanStr } from "@/services/shipping.service";

const getVietnamTime = (): Date => {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 3600000);
};

const generateShippingDesc = (
  method: "STANDARD" | "EXPRESS",
  isSameProvince: boolean,
): string => {
  const vnNow = getVietnamTime();

  if (method === "EXPRESS") {
    return vnNow.getHours() < 16
      ? "Dự kiến giao ngay trong chiều nay"
      : "Dự kiến giao vào sáng mai";
  }

  const minDate = new Date(vnNow.getTime() + 3 * 24 * 60 * 60 * 1000);
  const maxDate = new Date(vnNow.getTime() + 5 * 24 * 60 * 60 * 1000);

  const days = [
    "Chủ nhật",
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
  ];
  const minDayStr = days[minDate.getDay()];
  const formatDate = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;

  return `Dự kiến giao vào ${minDayStr}, ${formatDate(minDate)} - ${formatDate(maxDate)}`;
};

export const calculateShippingDiscount = (
  shopSubTotal: number,
  rawFee: number,
  method: "STANDARD" | "EXPRESS",
): number => {
  let maxDiscount = 0;
  if (shopSubTotal >= 1000000) maxDiscount = 70000;
  else if (shopSubTotal >= 500000) maxDiscount = 30000;
  else if (shopSubTotal >= 300000) maxDiscount = 15000;

  let finalDiscount = Math.min(rawFee, maxDiscount);

  if (method === "EXPRESS") {
    const expressSurcharge = 20000;
    const maxExpressDiscount = Math.max(0, rawFee - expressSurcharge);
    finalDiscount = Math.min(finalDiscount, maxExpressDiscount);
  }
  return finalDiscount;
};

export const generateShippingOptionsAsync = async (
  shopProvince: string,
  shopDistrict: string,
  userProvince: string,
  userDistrict: string,
  shopSubTotal: number,
): Promise<ShippingOptionInfo[]> => {
  const isSameProvince = cleanStr(shopProvince) === cleanStr(userProvince);

  const availableMethods: { id: "STANDARD" | "EXPRESS"; name: string }[] = [
    { id: "STANDARD", name: "Tiêu Chuẩn" },
  ];

  // Chỉ mở Hỏa Tốc khi cùng tỉnh
  if (isSameProvince) {
    availableMethods.push({ id: "EXPRESS", name: "Hỏa Tốc" });
  }

  const optionsPromises = availableMethods.map(async (method) => {
    const rawFee = await fetchShippingFee(
      shopProvince,
      shopDistrict,
      userProvince,
      userDistrict,
      method.id,
    );

    const discount = calculateShippingDiscount(shopSubTotal, rawFee, method.id);

    return {
      id: method.id,
      name: method.name,
      desc: generateShippingDesc(method.id, isSameProvince),
      originalPrice: rawFee,
      discount,
      finalPrice: Math.max(0, rawFee - discount),
    };
  });

  const resolved = await Promise.all(optionsPromises);

  if (resolved.length === 0) {
    return [
      {
        id: "STANDARD",
        name: "Tiêu Chuẩn",
        desc: generateShippingDesc("STANDARD", isSameProvince),
        originalPrice: 30000,
        discount: 0,
        finalPrice: 30000,
      },
    ];
  }

  return resolved;
};
