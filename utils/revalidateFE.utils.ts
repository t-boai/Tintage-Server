import { redisClient } from "@/config/redis.config";

export const triggerFullRevalidate = async (
  tag: string,
  redisKeys: string[] = [],
  webhookCooldownSeconds: number = 2,
): Promise<void> => {
  try {
    // xóa redis
    if (redisKeys.length > 0) {
      await Promise.allSettled(redisKeys.map((k) => redisClient.del(k)));
    }

    // Nếu trong 2s có 1 webhook bắn đi rồi thì không bắn thêm nữa
    const webhookLockKey = `throttle:revalidate:webhook:${tag}`;
    const canCallWebhook = await redisClient.set(webhookLockKey, "LOCKED", {
      NX: true,
      EX: webhookCooldownSeconds,
    });

    if (!canCallWebhook) {
      return;
    }

    // bắn webhook sang next
    const feUrl = process.env.NEXT_PUBLIC_FE_URL;
    const secret = process.env.REVALIDATE_SECRET_TOKEN;

    if (!feUrl || !secret) {
      console.warn(
        "Revalidate: Thiếu biến môi trường FE_URL hoặc SECRET_TOKEN",
      );
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    fetch(`${feUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ tag }),
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          const err = await res.text();
          console.error(`Revalidate Next.js Error Tag: ${tag} -`, err);
        } else {
          console.log(
            `Revalidate Next.js Success:  Đã purge CDN cho tag: ${tag}`,
          );
        }
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        console.error(`Revalidate Lỗi Mạng:`, error.message);
      });
  } catch (error) {
    console.error("Revalidate Lỗi Hệ Thống:", error);
  }
};
