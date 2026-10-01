import { Request, Response } from "express";
import mongoose from "mongoose";

// config & utils
import { redisClient } from "@/config/redis.config";
import { HOME_CACHE_KEYS } from "@/config/homeCacheKey.config";
import { triggerFullRevalidate } from "@/utils/revalidateFE.utils";

// services & crypto
import crypto from "node:crypto";
import { refundMomoPayment } from "@/services/momo.service";

// model
import Order from "@/models/order.model";
import PaymentTransaction from "@/models/payment-transaction.model";
import SubOrder from "@/models/sub-order.model";
import Product from "@/models/products.models";

export const handleMomoIPN = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      partnerCode,
      orderId,
      requestId,
      amount,
      orderInfo,
      orderType,
      transId,
      resultCode,
      message,
      payType,
      responseTime,
      extraData,
      signature,
    } = req.body;

    const accessKey = process.env.MOMO_ACCESS_KEY!;
    const secretKey = process.env.MOMO_SECRET_KEY!;

    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;

    const generatedSignature = crypto
      .createHmac("sha256", secretKey)
      .update(rawSignature)
      .digest("hex");

    if (generatedSignature !== signature) {
      console.warn(`MoMo IPN Alert: Chữ ký không hợp lệ cho mã: ${orderId}`);
      res.status(400).json({ message: "Invalid Signature" });
      return;
    }

    const baseOrderCode = orderId.includes("_R")
      ? orderId.split("_R")[0]
      : orderId;

    const orderStateLockKey = `lock:order_state:${baseOrderCode}`;
    const acquiredLock = await redisClient.set(
      orderStateLockKey,
      "PROCESSING",
      { NX: true, EX: 30 },
    );

    if (!acquiredLock) {
      console.warn(
        `IPN Lock Busy Đơn ${baseOrderCode} đang được xử lý. Yêu cầu MoMo thử lại sau.`,
      );
      res.status(409).json({ message: "Resource locked, please retry later" });
      return;
    }

    try {
      const [transaction, order] = await Promise.all([
        PaymentTransaction.findOne({ orderCode: baseOrderCode }).lean(),
        Order.findOne({ orderCode: baseOrderCode }).lean(),
      ]);

      if (!transaction || !order) {
        res.status(204).end();
        return;
      }

      if (order.status === "CANCELLED" && Number(resultCode) === 0) {
        console.warn(
          `Split-Brain Đơn ${baseOrderCode} đã hủy nhưng thanh toán thành công. Tiến hành Auto-Refund.`,
        );
        refundMomoPayment({
          orderId,
          orderCode: baseOrderCode,
          amount: Number(amount),
          transId: String(transId),
        })
          .then((refundRes) =>
            console.log(`Auto-Refund Success ${baseOrderCode}:`, refundRes),
          )
          .catch((refundErr) =>
            console.error(
              `Auto-Refund FAILED]Cần can thiệp thủ công cho ${baseOrderCode}:`,
              refundErr,
            ),
          );
        res.status(204).end();
        return;
      }

      if (transaction.status !== "PENDING") {
        res.status(204).end();
        return;
      }

      if (Number(amount) !== transaction.amount) {
        console.error(
          `MoMo Fraud Alert Lệch số tiền đơn ${baseOrderCode}. Nhận: ${amount}, Yêu cầu: ${transaction.amount}`,
        );
        res.status(204).end();
        return;
      }

      const dbSession = await mongoose.startSession();
      dbSession.startTransaction();

      try {
        const isSuccess = Number(resultCode) === 0;

        if (isSuccess) {
          await PaymentTransaction.updateOne(
            { orderCode: baseOrderCode },
            {
              $set: {
                status: "SUCCESS",
                transactionId: String(transId),
                gatewayResponse: req.body,
              },
            },
            { session: dbSession },
          );
          await Order.updateOne(
            { orderCode: baseOrderCode },
            { $set: { status: "PROCESSING" } },
            { session: dbSession },
          );
          await SubOrder.updateMany(
            { orderCode: baseOrderCode },
            { $set: { status: "PENDING" } },
            { session: dbSession },
          );

          await dbSession.commitTransaction();
          dbSession.endSession();
        } else {
          const subOrders = await SubOrder.find(
            { orderCode: baseOrderCode },
            { items: 1 },
          ).session(dbSession);

          const restockMap = new Map<string, number>();
          for (const sub of subOrders) {
            for (const item of sub.items) {
              const currentQty = restockMap.get(item.productId.toString()) || 0;
              restockMap.set(
                item.productId.toString(),
                currentQty + item.quantity,
              );
            }
          }

          const sortedProductIds = Array.from(restockMap.keys()).sort();
          const bulkRestockOps = sortedProductIds.map((productId) => {
            const quantity = restockMap.get(productId)!;
            return {
              updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(productId) },
                update: { $inc: { stock: quantity, salesCount: -quantity } },
              },
            };
          });

          await PaymentTransaction.updateOne(
            { orderCode: baseOrderCode },
            { $set: { status: "FAILED", gatewayResponse: req.body } },
            { session: dbSession },
          );
          await Order.updateOne(
            { orderCode: baseOrderCode },
            { $set: { status: "PAYMENT_FAILED" } },
            { session: dbSession },
          );
          await SubOrder.updateMany(
            { orderCode: baseOrderCode },
            { $set: { status: "CANCELLED" } },
            { session: dbSession },
          );

          if (bulkRestockOps.length > 0) {
            await Product.bulkWrite(bulkRestockOps, { session: dbSession });
          }

          await dbSession.commitTransaction();
          dbSession.endSession();

          if (bulkRestockOps.length > 0) {
            triggerFullRevalidate(
              "home_products",
              [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
              2,
            );
          }
        }

        res.status(204).end();
      } catch (dbError) {
        if (dbSession.inTransaction()) await dbSession.abortTransaction();
        dbSession.endSession();
        throw dbError;
      }
    } finally {
      await redisClient.del(orderStateLockKey).catch(console.error);
    }
  } catch (error) {
    console.error("MoMo IPN Critical Error: ", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
