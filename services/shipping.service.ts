import { redisClient } from "@/config/redis.config";
import { ghtkAxiosClient } from "@/config/http.config";
import { runWithSingleflight } from "@/helpers/asyncLock.helper";

const REGION_NORTH = new Set([
  "ha noi",
  "hai phong",
  "quang ninh",
  "bac ninh",
  "hai duong",
  "hung yen",
  "thai binh",
  "nam dinh",
  "ninh binh",
  "ha nam",
  "thai nguyen",
  "bac giang",
  "phu tho",
  "vinh phuc",
  "tuyen quang",
  "lang son",
  "cao bang",
  "ha giang",
  "bac kan",
  "yen bai",
  "lao cai",
  "dien bien",
  "son la",
  "hoa binh",
  "lai chau",
]);

const REGION_MID = new Set([
  "da nang",
  "thua thien hue",
  "hue",
  "quang nam",
  "quang ngai",
  "quang binh",
  "quang tri",
  "nghe an",
  "ha tinh",
  "thanh hoa",
  "binh dinh",
  "phu yen",
  "khanh hoa",
  "ninh thuan",
  "binh thuan",
  "kon tum",
  "gia lai",
  "dak lak",
  "dak nong",
  "lam dong",
]);

export const cleanStr = (s: string): string => {
  if (!s) return "";
  let cleaned = s
    .normalize("NFC")
    .toLowerCase()
    .replace(/^(tỉnh|thành phố|tp|quận|huyện|thị xã|tx)\.?\s*/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();

  // Gom tất cả các biến thể của Sài Gòn về 1 chuẩn duy nhất
  if (
    cleaned === "hcm" ||
    cleaned.includes("ho chi minh") ||
    cleaned === "sai gon"
  ) {
    return "ho chi minh";
  }

  return cleaned;
};

const getRegion = (province: string): "NORTH" | "MID" | "SOUTH" => {
  const p = cleanStr(province);
  if (p === "hcm" || p.includes("ho chi minh")) return "SOUTH";
  if (REGION_NORTH.has(p)) return "NORTH";
  if (REGION_MID.has(p)) return "MID";
  return "SOUTH";
};

export const calculateFallbackFee = (
  shopProv: string,
  userProv: string,
  method: "STANDARD" | "EXPRESS" = "STANDARD",
): number => {
  const isSameProv = cleanStr(shopProv) === cleanStr(userProv);
  let baseFee = 35000;

  if (isSameProv) {
    baseFee = 20000;
  } else if (getRegion(shopProv) === getRegion(userProv)) {
    baseFee = 30000;
  }

  if (method === "EXPRESS") {
    baseFee += 20000;
  }

  return baseFee;
};

export const fetchShippingFee = async (
  shopProvince: string,
  shopDistrict: string,
  userProvince: string,
  userDistrict: string,
  method: "STANDARD" | "EXPRESS" = "STANDARD",
): Promise<number> => {
  const sp = cleanStr(shopProvince).replace(/\s+/g, "");
  const sd = cleanStr(shopDistrict).replace(/\s+/g, "");
  const up = cleanStr(userProvince).replace(/\s+/g, "");
  const ud = cleanStr(userDistrict).replace(/\s+/g, "");

  const cacheKey = `ship_fee:ghtk:${sp}_${sd}_${up}_${ud}_${method}`;

  try {
    const cachedFee = await redisClient.get(cacheKey);
    if (cachedFee !== null && cachedFee !== undefined) {
      const parsed = parseInt(cachedFee, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  } catch (err) {
    console.error("Redis Cache Error, bypassing:", err);
  }

  try {
    return await runWithSingleflight(
      cacheKey,
      async () => {
        try {
          const ghtkToken = process.env.GHTK_API_TOKEN;
          const deliverOption = method === "EXPRESS" ? "xteam" : "none";

          const response = await ghtkAxiosClient.get("/services/shipment/fee", {
            params: {
              pick_province: shopProvince,
              pick_district: shopDistrict,
              province: userProvince,
              district: userDistrict,
              weight: 500,
              deliver_option: deliverOption,
            },
            headers: { Token: ghtkToken },
          });

          if (
            response.data?.success &&
            typeof response.data.fee?.fee === "number"
          ) {
            const actualFee = response.data.fee.fee;

            if (actualFee > 100000) {
              console.warn(
                `GHTK Cước dị thường: ${actualFee}đ -> Chuyển sang Fallback.`,
              );
              return calculateFallbackFee(shopProvince, userProvince, method);
            }

            const jitterSeconds = Math.floor(Math.random() * 3600) - 1800;
            const ttl = 86400 + jitterSeconds;

            redisClient
              .set(cacheKey, actualFee.toString(), { EX: ttl })
              .catch((e) => console.error("[Redis Set Error]:", e));

            return actualFee;
          }

          console.warn(
            `GHTK Rejected: ${response.data?.message || "Route not supported"}`,
          );
          return calculateFallbackFee(shopProvince, userProvince, method);
        } catch (error: any) {
          console.error(`[GHTK Call Error]: ${error.message}`);
          return calculateFallbackFee(shopProvince, userProvince, method);
        }
      },
      3500,
    );
  } catch (singleflightError) {
    console.error("[Singleflight Fallback Triggered]:", singleflightError);
    return calculateFallbackFee(shopProvince, userProvince, method);
  }
};
