import { Response } from "express";
import mongoose from "mongoose";

// z & crypto
import z from "zod";
import { randomBytes, randomUUID } from "node:crypto";

// interfaces & config
import { AccountRequest } from "@/interfaces/request.interfaces";
import { HOME_CACHE_KEYS } from "@/config/homeCacheKey.config";
import { redisClient, SAFE_UNLOCK_LUA } from "@/config/redis.config";
import { CHECKOUT_TOKEN_REGEX } from "@/config/check-token-regex.config";

// services & utils
import {
  checkMomoOrderStatus,
  createMomoPaymentUrl,
} from "@/services/momo.service";
import {
  cancelOrderAndRestock,
  processOrderSuccess,
} from "@/services/order.service";
import { triggerFullRevalidate } from "@/utils/revalidateFE.utils";

// models
import Order from "@/models/order.model";
import PaymentTransaction from "@/models/payment-transaction.model";
import Cart from "@/models/carts.models";
import SubOrder from "@/models/sub-order.model";
import Product from "@/models/products.models";
import { orderExpirationQueue } from "@/queues/orderExpiration.queue";

const placeOrderSchema = z.object({
  paymentMethod: z.enum(["COD", "MOMO", "VNPAY"], {
    message:
      "Vui lòng chọn phương thức thanh toán hợp lệ (COD, MOMO, hoặc VNPAY).",
  }),
  notes: z
    .record(z.string().trim(), z.string().trim().max(255))
    .optional()
    .default({}),
});

const retryPaymentSchema = z.object({
  paymentMethod: z.enum(["COD", "MOMO", "VNPAY"], {
    message: "Phương thức thanh toán không hợp lệ.",
  }),
});

export const placeOrder = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  const userId = req.account?.id;
  const { token } = req.params;

  if (!userId || !CHECKOUT_TOKEN_REGEX.test(`${token}`)) {
    res.status(400).json({ code: "error", message: "Yêu cầu không hợp lệ." });
    return;
  }

  const parseResult = placeOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      code: "error",
      message: parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
    });
    return;
  }
  const { paymentMethod, notes } = parseResult.data;

  // Khóa Idemptency
  const lockKey = `lock:place_order:${token}`;
  const lockIdentifier = randomUUID();

  const isLocked = await redisClient.set(lockKey, lockIdentifier, {
    NX: true,
    EX: 10,
  });
  if (!isLocked) {
    res.status(429).json({
      code: "error",
      message: "Đơn hàng đang được xử lý, vui lòng không nhấn liên tục.",
    });
    return;
  }

  //  Chống Hoarding (giam hàng phá)
  const pendingOrdersCount = await Order.countDocuments({
    userId,
    status: "PENDING_PAYMENT",
  });

  if (pendingOrdersCount >= 2) {
    await redisClient
      .eval(SAFE_UNLOCK_LUA, { keys: [lockKey], arguments: [lockIdentifier] })
      .catch(console.error);
    res.status(403).json({
      code: "error",
      message:
        "Bạn đang có đơn hàng chờ thanh toán. Vui lòng hoàn tất hoặc hủy đơn cũ trước khi đặt đơn mới!",
    });
    return;
  }

  const dbSession = await mongoose.startSession();
  let hasSoldOutProduct = false;
  let orderCode = "";
  let sessionData: any;

  try {
    // check sessions
    const redisKey = `checkout_session:${token}`;
    const sessionString = await redisClient.get(redisKey);
    if (!sessionString) throw new Error("SESSION_EXPIRED");

    sessionData = JSON.parse(sessionString);
    if (sessionData.userId !== userId) throw new Error("FORBIDDEN");
    if (!sessionData.shippingAddress) throw new Error("MISSING_ADDRESS");

    const isShippingCalculated = sessionData.subOrders?.every(
      (sub: any) =>
        sub.shippingMethod && typeof sub.finalShippingFee === "number",
    );
    if (!isShippingCalculated) throw new Error("MISSING_SHIPPING");

    const randomSuffix = randomBytes(3).toString("hex").toUpperCase();
    orderCode = `TIN-${Date.now()}-${randomSuffix}`;

    // Transaction (auto retry khi mạng yếu)
    await dbSession.withTransaction(async () => {
      const itemMap = new Map<string, { quantity: number; name: string }>();
      for (const subOrder of sessionData.subOrders) {
        for (const item of subOrder.items) {
          const current = itemMap.get(item.productId) || {
            quantity: 0,
            name: item.name,
          };
          current.quantity += item.quantity;
          itemMap.set(item.productId, current);
        }
      }

      const sortedProductIds = Array.from(itemMap.keys()).sort();
      const bulkStockOperations = sortedProductIds.map((productId) => {
        const { quantity } = itemMap.get(productId)!;
        return {
          updateOne: {
            filter: {
              _id: new mongoose.Types.ObjectId(productId),
              stock: { $gte: quantity },
              isActive: true,
              deleted: false,
            },
            update: { $inc: { stock: -quantity, salesCount: quantity } },
          },
        };
      });

      const bulkResult = await Product.bulkWrite(bulkStockOperations, {
        session: dbSession,
      });

      if (bulkResult.modifiedCount !== sortedProductIds.length) {
        const currentProducts = await Product.find(
          { _id: { $in: sortedProductIds } },
          { _id: 1, name: 1, stock: 1 },
        ).session(dbSession);

        for (const p of currentProducts) {
          const reqItem = itemMap.get(p._id.toString());
          if (reqItem && p.stock < reqItem.quantity) {
            throw new Error(`OUT_OF_STOCK_${p.name}`);
          }
        }
        throw new Error("OUT_OF_STOCK_GENERIC");
      }

      hasSoldOutProduct = !!(await Product.exists({
        _id: { $in: sortedProductIds },
        stock: { $lte: 0 },
      }).session(dbSession));

      const [createdOrder] = await Order.create(
        [
          {
            userId,
            orderCode,
            paymentMethod,
            grandTotal: sessionData.financials.grandTotal,
            shippingAddress: sessionData.shippingAddress,
            status: paymentMethod === "COD" ? "PROCESSING" : "PENDING_PAYMENT",
          },
        ],
        { session: dbSession },
      );

      const subOrdersToInsert = sessionData.subOrders.map((sub: any) => ({
        orderId: createdOrder._id,
        orderCode,
        buyerId: userId,
        sellerId: sub.sellerInfo.id,
        items: sub.items,
        financials: {
          shopSubTotal: sub.shopSubTotal,
          shippingFee: sub.shippingFee,
          shippingDiscount: sub.shippingDiscount,
          finalShippingFee: sub.finalShippingFee,
        },
        shippingMethod: sub.shippingMethod,
        note: notes?.[sub.sellerInfo.id] || "",
        status: "PENDING",
      }));

      await Promise.all([
        SubOrder.insertMany(subOrdersToInsert, { session: dbSession }),
        PaymentTransaction.create(
          [
            {
              orderId: createdOrder._id,
              orderCode,
              userId,
              provider: paymentMethod,
              amount: sessionData.financials.grandTotal,
              status: "PENDING",
              transactionId: "",
            },
          ],
          { session: dbSession },
        ),
        Cart.updateOne(
          { userId },
          { $pull: { items: { productId: { $in: sortedProductIds } } } },
          { session: dbSession },
        ),
      ]);
    });
  } catch (error: any) {
    dbSession.endSession();
    await redisClient
      .eval(SAFE_UNLOCK_LUA, { keys: [lockKey], arguments: [lockIdentifier] })
      .catch(console.error);

    if (error.message.startsWith("OUT_OF_STOCK_")) {
      const productName = error.message.replace("OUT_OF_STOCK_", "");
      res.status(409).json({
        code: "OUT_OF_STOCK",
        message:
          productName === "GENERIC"
            ? "Một số sản phẩm vừa hết hàng."
            : `Sản phẩm "${productName}" vừa hết hàng.`,
      });
      return;
    }
    if (error.message === "SESSION_EXPIRED") {
      res.status(404).json({
        code: "SESSION_EXPIRED",
        message: "Phiên thanh toán đã hết hạn, vui lòng đặt lại từ giỏ hàng.",
      });
      return;
    }
    if (error.message === "MISSING_ADDRESS") {
      res.status(400).json({
        code: "error",
        message: "Vui lòng chọn địa chỉ giao hàng hợp lệ.",
      });
      return;
    }
    if (error.message === "MISSING_SHIPPING") {
      res.status(400).json({
        code: "error",
        message: "Hệ thống chưa tính được phí vận chuyển, vui lòng thử lại.",
      });
      return;
    }
    if (error.message === "FORBIDDEN") {
      res.status(403).json({
        code: "error",
        message: "Bạn không có quyền thao tác trên phiên thanh toán này.",
      });
      return;
    }

    res.status(500).json({
      code: "error",
      message: "Hệ thống đang quá tải, vui lòng thử lại sau ít phút.",
    });
    return;
  }

  // dọn dẹp & call background jobs
  dbSession.endSession();
  await redisClient.del(`checkout_session:${token}`);
  await redisClient
    .eval(SAFE_UNLOCK_LUA, { keys: [lockKey], arguments: [lockIdentifier] })
    .catch(console.error);

  if (paymentMethod !== "COD") {
    orderExpirationQueue
      .add(
        `expire-order-${orderCode}`,
        { orderCode, paymentMethod },
        {
          delay: 15 * 60 * 1000,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      )
      .catch(console.error);
  }

  if (hasSoldOutProduct) {
    triggerFullRevalidate(
      "home_products",
      [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
      2,
    ).catch(console.error);
  }

  if (paymentMethod === "COD") {
    res.status(200).json({
      code: "success",
      message: "Đặt hàng thành công!",
      data: { orderCode, nextAction: "REDIRECT_THANK_YOU" },
    });
    return;
  }

  try {
    const paymentUrl = await createMomoPaymentUrl({
      orderCode,
      amount: sessionData.financials.grandTotal,
      orderInfo: `Thanh toán đơn hàng ${orderCode} tại Tintage`,
    });
    res.status(200).json({
      code: "success",
      message: "Đang chuyển hướng sang cổng thanh toán...",
      data: { orderCode, nextAction: "REDIRECT_PAYMENT_GATEWAY", paymentUrl },
    });
  } catch (error) {
    console.error("[MoMo Gateway Error]:", error);
    res.status(502).json({
      code: "error",
      message:
        "Lỗi kết nối cổng thanh toán MoMo. Đơn hàng đã được tạo, vui lòng thanh toán lại trong phần Đơn mua.",
      data: { orderCode, nextAction: "REDIRECT_ORDER_HISTORY" },
    });
  }
};

export const retryPayment = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  const userId = req.account?.id;
  const orderCode = req.params.orderCode as string;

  if (!userId || !orderCode) {
    res.status(400).json({ code: "error", message: "Yêu cầu không hợp lệ." });
    return;
  }

  const parseResult = retryPaymentSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      code: "error",
      message: parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
    });
    return;
  }
  const { paymentMethod } = parseResult.data;

  // Khóa idempotency chống spam click
  const lockKey = `lock:retry_payment:${orderCode}`;
  const lockIdentifier = randomUUID();
  const acquiredLock = await redisClient.set(lockKey, lockIdentifier, {
    NX: true,
    EX: 5,
  });

  if (!acquiredLock) {
    res.status(429).json({
      code: "error",
      message:
        "Yêu cầu thanh toán lại đang được xử lý, vui lòng đợi trong giây lát.",
    });
    return;
  }

  try {
    const [order, transaction] = await Promise.all([
      Order.findOne({ orderCode, userId }).lean(),
      PaymentTransaction.findOne({ orderCode }).lean(),
    ]);

    if (!order || !transaction || order.status !== "PENDING_PAYMENT") {
      res.status(400).json({
        code: "error",
        message:
          "Đơn hàng không hợp lệ hoặc không ở trạng thái chờ thanh toán.",
      });
      return;
    }

    // cod
    if (paymentMethod === "COD") {
      const dbSession = await mongoose.startSession();
      await dbSession.withTransaction(async () => {
        await Order.updateOne(
          { orderCode },
          { $set: { paymentMethod: "COD" } },
          { session: dbSession },
        );
        await PaymentTransaction.updateOne(
          { orderCode },
          { $set: { provider: "COD", gatewayReference: "" } },
          { session: dbSession },
        );

        await processOrderSuccess(orderCode, "", dbSession);
      });
      dbSession.endSession();

      Promise.allSettled([
        orderExpirationQueue
          .getJob(`expire-order-${orderCode}`)
          .then((job) => job?.remove()),
        orderExpirationQueue
          .getJob(`expire-retry-${orderCode}`)
          .then((job) => job?.remove()),
      ]);

      res.status(200).json({
        code: "success",
        data: { orderCode, nextAction: "REDIRECT_THANK_YOU" },
      });
      return;
    }

    // momo
    if (paymentMethod === "MOMO") {
      const paymentReferenceId = `${order.orderCode}_R${Date.now().toString().slice(-6)}`;

      await Promise.all([
        Order.updateOne({ orderCode }, { $set: { paymentMethod: "MOMO" } }),
        PaymentTransaction.updateOne(
          { orderCode },
          { $set: { provider: "MOMO", gatewayReference: paymentReferenceId } },
        ),
      ]);

      const paymentUrl = await createMomoPaymentUrl({
        orderCode: paymentReferenceId,
        amount: order.grandTotal,
        orderInfo: `Thanh toán lại đơn hàng ${order.orderCode} tại Tintage`,
      });

      Promise.allSettled([
        orderExpirationQueue
          .getJob(`expire-order-${orderCode}`)
          .then((job) => job?.remove()),
        orderExpirationQueue
          .getJob(`expire-retry-${orderCode}`)
          .then((job) => job?.remove()),
      ]);

      orderExpirationQueue
        .add(
          `expire-retry-${orderCode}`,
          { orderCode, paymentMethod },
          {
            jobId: `expire-retry-${orderCode}`,
            delay: 15 * 60 * 1000,
            removeOnComplete: true,
            attempts: 3,
          },
        )
        .catch(console.error);

      res.status(200).json({
        code: "success",
        data: {
          orderCode,
          nextAction: "REDIRECT_PAYMENT_GATEWAY",
          paymentUrl,
        },
      });
      return;
    }

    res.status(400).json({
      code: "error",
      message: "Phương thức thanh toán chưa được hỗ trợ.",
    });
  } catch (error) {
    console.error("Retry Payment System Error:", error);
    res.status(500).json({
      code: "error",
      message: "Hệ thống đang quá tải, vui lòng thử lại sau.",
    });
  } finally {
    await redisClient
      .eval(SAFE_UNLOCK_LUA, { keys: [lockKey], arguments: [lockIdentifier] })
      .catch(console.error);
  }
};

export const syncPaymentStatus = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  const rawOrderCode = req.params.orderCode as string;
  const userId = req.account?.id;
  const baseOrderCode = rawOrderCode.includes("_R")
    ? rawOrderCode.split("_R")[0]
    : rawOrderCode;

  const orderStateLockKey = `lock:order_state:${baseOrderCode}`;
  const lockIdentifier = randomUUID();

  const acquiredLock = await redisClient.set(
    orderStateLockKey,
    lockIdentifier,
    { NX: true, EX: 5 },
  );
  if (!acquiredLock) {
    res
      .status(200)
      .json({ code: "success", data: { status: "PENDING_PAYMENT" } });
    return;
  }

  try {
    const order = await Order.findOne({
      orderCode: baseOrderCode,
      userId,
    }).lean();
    if (!order) {
      res.status(404).json({ code: "error", message: "Not found" });
      return;
    }
    if (order.status !== "PENDING_PAYMENT") {
      res.status(200).json({ code: "success", data: { status: order.status } });
      return;
    }

    const transaction = await PaymentTransaction.findOne({
      orderCode: baseOrderCode,
    }).lean();
    const gatewayRef = transaction?.gatewayReference || baseOrderCode;
    const momoStatus = await checkMomoOrderStatus(gatewayRef);
    const resultCode = Number(momoStatus.resultCode);

    const dbSession = await mongoose.startSession();
    let needsCacheClear = false;

    try {
      await dbSession.withTransaction(async () => {
        if (resultCode === 0) {
          await processOrderSuccess(baseOrderCode, "", dbSession);
        } else if (resultCode === 1006 || resultCode === 1005) {
          needsCacheClear = await cancelOrderAndRestock(
            baseOrderCode,
            dbSession,
          );
        }
      });
    } finally {
      dbSession.endSession();
    }

    if (resultCode === 0 || resultCode === 1006 || resultCode === 1005) {
      Promise.allSettled([
        orderExpirationQueue
          .getJob(`expire-order-${baseOrderCode}`)
          .then((job) => job?.remove()),
        orderExpirationQueue
          .getJob(`expire-retry-${baseOrderCode}`)
          .then((job) => job?.remove()),
      ]);
      if (needsCacheClear) {
        triggerFullRevalidate(
          "home_products",
          [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
          2,
        ).catch(console.error);
      }
      const nextStatus = resultCode === 0 ? "PROCESSING" : "CANCELLED";
      res.status(200).json({ code: "success", data: { status: nextStatus } });
      return;
    }

    res
      .status(200)
      .json({ code: "success", data: { status: "PENDING_PAYMENT" } });
  } catch (error) {
    res.status(500).json({ code: "error", message: "Lỗi đồng bộ." });
  } finally {
    await redisClient
      .eval(SAFE_UNLOCK_LUA, {
        keys: [orderStateLockKey],
        arguments: [lockIdentifier],
      })
      .catch(console.error);
  }
};

export const getMyPendingOrder = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Từ chối." });
      return;
    }

    const pendingOrder = await Order.findOne({
      userId,
      status: "PENDING_PAYMENT",
    })
      .sort({ createdAt: -1 })
      .select("orderCode")
      .lean();

    res.status(200).json({
      code: "success",
      data: pendingOrder ? { orderCode: pendingOrder.orderCode } : null,
    });
  } catch (error) {
    res.status(500).json({ code: "error", message: "Lỗi hệ thống." });
  }
};
