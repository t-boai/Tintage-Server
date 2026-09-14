import { createClient } from "redis";

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis Lỗi kết nối: ", err);
});

redisClient.on("connect", () => {
  console.log("Redis Đã kết nối thành công");
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    console.error("Redis Không thể khởi động:", error);
  }
};
