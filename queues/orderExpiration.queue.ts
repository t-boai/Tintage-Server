import mongoose from "mongoose";

// bull
import { Queue, Worker, Job } from "bullmq";

// crypto & service
import { randomUUID } from "node:crypto";
import {
  processOrderSuccess,
  cancelOrderAndRestock,
} from "@/services/order.service";

// configs & utils
import { redisClient, SAFE_UNLOCK_LUA } from "@/config/redis.config";
import { HOME_CACHE_KEYS } from "@/config/homeCacheKey.config";
import { triggerFullRevalidate } from "@/utils/revalidateFE.utils";

// models
import Order from "@/models/order.model";
import PaymentTransaction from "@/models/payment-transaction.model";
import { checkMomoOrderStatus } from "@/services/momo.service";

export const ORDER_EXPIRATION_QUEUE = "order-expiration-queue";
export const orderExpirationQueue = new Queue(ORDER_EXPIRATION_QUEUE, {
  connection: redisClient,
});

const orderExpirationWorker = new Worker(
  ORDER_EXPIRATION_QUEUE,
  async (job: Job) => {
    const { orderCode, paymentMethod } = job.data;
    const lockKey = `lock:order_state:${orderCode}`;
    const lockIdentifier = randomUUID();

    const acquiredLock = await redisClient.set(lockKey, lockIdentifier, {
      NX: true,
      EX: 15,
    });
    if (!acquiredLock) {
      throw new Error(
        `Lock Busy Đơn ${orderCode} đang được IPN xử lý. Retry sau.`,
      );
    }

    try {
      const order = await Order.findOne({ orderCode }).lean();
      if (!order || order.status !== "PENDING_PAYMENT") return;

      let isActuallyPaid = false;
      const transaction = await PaymentTransaction.findOne({
        orderCode,
      }).lean();
      const gatewayRef = transaction?.gatewayReference || orderCode;

      if (paymentMethod === "MOMO") {
        const momoStatus = await checkMomoOrderStatus(gatewayRef);
        if (momoStatus.resultCode === 0) isActuallyPaid = true;
      }

      const dbSession = await mongoose.startSession();
      let needsCacheClear = false;

      try {
        await dbSession.withTransaction(async () => {
          if (isActuallyPaid) {
            await processOrderSuccess(orderCode, gatewayRef, dbSession);
          } else {
            needsCacheClear = await cancelOrderAndRestock(orderCode, dbSession);
          }
        });
      } finally {
        dbSession.endSession();
      }

      if (needsCacheClear) {
        triggerFullRevalidate(
          "home_products",
          [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
          2,
        ).catch(console.error);
      }
    } finally {
      await redisClient
        .eval(SAFE_UNLOCK_LUA, { keys: [lockKey], arguments: [lockIdentifier] })
        .catch(console.error);
    }
  },
  { connection: redisClient, concurrency: 10 },
);

orderExpirationWorker.on("failed", (job, err) => {
  console.error(`BullMQ Error Job ${job?.id} thất bại:`, err.message);
});
