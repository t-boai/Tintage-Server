import { Response } from "express";
import mongoose from "mongoose";

// z & crypto
import z from "zod";
import { randomBytes, randomUUID } from "node:crypto";

// interfaces & config
import { AccountRequest } from "@/interfaces/request.interfaces";
import { HOME_CACHE_KEYS } from "@/config/homeCacheKey.config";
import { redisClient } from "@/config/redis.config";
import { CHECKOUT_TOKEN_REGEX } from "@/config/check-token-regex.config";

// services & utils
import { createMomoPaymentUrl } from "@/services/momo.service";
import { triggerFullRevalidate } from "@/utils/revalidateFE.utils";

// models
import Order from "@/models/order.model";
import PaymentTransaction from "@/models/payment-transaction.model";
import Cart from "@/models/carts.models";
import SubOrder from "@/models/sub-order.model";
import Product from "@/models/products.models";

const SAFE_UNLOCK_LUA = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else 
    return 0
  end
`;

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

  //  idempotency lock
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

  const dbSession = await mongoose.startSession();

  try {
    // check session redis
    const redisKey = `checkout_session:${token}`;
    const sessionString = await redisClient.get(redisKey);
    if (!sessionString) throw new Error("SESSION_EXPIRED");

    const sessionData = JSON.parse(sessionString);
    if (sessionData.userId !== userId) throw new Error("FORBIDDEN");
    if (!sessionData.shippingAddress) throw new Error("MISSING_ADDRESS");

    const isShippingCalculated = sessionData.subOrders?.every(
      (sub: any) =>
        sub.shippingMethod && typeof sub.finalShippingFee === "number",
    );
    if (!isShippingCalculated) throw new Error("MISSING_SHIPPING");

    // acid transaction
    dbSession.startTransaction();

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

    // Chống Deadlock: Sắp xếp ID cố định
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

    // Kiểm tra hụt kho
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

    //  Kiểm tra có sản phẩm nào stock =0?
    // Chỉ kích hoạt Webhook xóa cache trang chủ nếu hết hàng
    const hasSoldOutProduct = await Product.exists({
      _id: { $in: sortedProductIds },
      stock: { $lte: 0 },
    }).session(dbSession);

    const randomSuffix = randomBytes(3).toString("hex").toUpperCase();
    const orderCode = `TIN-${Date.now()}-${randomSuffix}`;

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
      items: sub.items.map((item: any) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        size: item.size || "Mặc định",
        image: item.image,
      })),
      financials: {
        shopSubTotal: sub.shopSubTotal,
        shippingFee: sub.shippingFee,
        shippingDiscount: sub.shippingDiscount,
        finalShippingFee: sub.finalShippingFee,
      },
      shippingMethod: sub.shippingMethod,
      note: notes[sub.sellerInfo.id] || "",
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

    await dbSession.commitTransaction();
    dbSession.endSession();

    // Dọn Session và nhả Lock Redis
    await redisClient.del(redisKey);
    await redisClient.eval(SAFE_UNLOCK_LUA, {
      keys: [lockKey],
      arguments: [lockIdentifier],
    });

    if (hasSoldOutProduct) {
      await triggerFullRevalidate(
        "home_products",
        [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
        2,
      );
    }

    if (paymentMethod === "COD") {
      res.status(200).json({
        code: "success",
        message: "Đặt hàng thành công!",
        data: { orderCode, nextAction: "REDIRECT_THANK_YOU" },
      });
      return;
    }

    if (paymentMethod === "MOMO") {
      try {
        const paymentUrl = await createMomoPaymentUrl({
          orderCode,
          amount: sessionData.financials.grandTotal,
          orderInfo: `Thanh toán đơn hàng ${orderCode} tại Tintage`,
        });

        res.status(200).json({
          code: "success",
          message: "Đang chuyển hướng sang cổng thanh toán...",
          data: {
            orderCode,
            nextAction: "REDIRECT_PAYMENT_GATEWAY",
            paymentUrl,
          },
        });
        return;
      } catch (momoError) {
        console.error("[MoMo Gateway Error]:", momoError);
        // DB đã lưu thành công đơn hàng ở trạng thái PENDING_PAYMENT.
        // Trả về 502 Bad Gateway thay vì 500 để xác định lỗi từ bên thứ 3.
        res.status(502).json({
          code: "error",
          message:
            "Lỗi kết nối cổng thanh toán MoMo. Đơn hàng đã được tạo, vui lòng thanh toán lại trong phần Đơn mua.",
          data: { orderCode, nextAction: "REDIRECT_ORDER_HISTORY" },
        });
        return;
      }
    }

    // (Dự phòng cho VNPAY sau này)
    res.status(400).json({
      code: "error",
      message: "Phương thức thanh toán chưa được hỗ trợ.",
    });
  } catch (error: any) {
    if (dbSession.inTransaction()) await dbSession.abortTransaction();
    dbSession.endSession();

    await redisClient.eval(SAFE_UNLOCK_LUA, {
      keys: [lockKey],
      arguments: [lockIdentifier],
    });

    if (error.message.startsWith("OUT_OF_STOCK_")) {
      const productName = error.message.replace("OUT_OF_STOCK_", "");
      res.status(409).json({
        code: "OUT_OF_STOCK",
        message:
          productName === "GENERIC"
            ? "Một số sản phẩm vừa hết hàng, vui lòng kiểm tra lại giỏ hàng."
            : `Rất tiếc! Sản phẩm "${productName}" vừa hết hàng do có người nhanh tay hơn.`,
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

    console.error("[Place Order Error]:", error);
    res.status(500).json({
      code: "error",
      message: "Hệ thống đang quá tải, vui lòng thử lại sau ít phút.",
    });
  }
};
