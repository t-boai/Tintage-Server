import mongoose from "mongoose";
import Order from "@/models/order.model";
import SubOrder from "@/models/sub-order.model";
import PaymentTransaction from "@/models/payment-transaction.model";
import Product from "@/models/products.models";

// Xử lý đơn hàng thanh toán thành công
export const processOrderSuccess = async (
  orderCode: string,
  transId: string,
  session: mongoose.ClientSession,
  gatewayResponse: any = null,
) => {
  // Update tuần tự để tránh lỗi WriteConflict
  await PaymentTransaction.updateOne(
    { orderCode },
    { $set: { status: "SUCCESS", transactionId: transId, gatewayResponse } },
    { session },
  );
  await Order.updateOne(
    { orderCode },
    { $set: { status: "PROCESSING" } },
    { session },
  );
  await SubOrder.updateMany(
    { orderCode },
    { $set: { status: "PENDING" } },
    { session },
  );
};

// Xử lý hủy đơn và hoàn lại kho an toàn
export const cancelOrderAndRestock = async (
  orderCode: string,
  session: mongoose.ClientSession,
  gatewayResponse: any = null,
): Promise<boolean> => {
  const subOrders = await SubOrder.find({ orderCode }, { items: 1 }).session(
    session,
  );

  const restockMap = new Map<string, number>();
  for (const sub of subOrders) {
    for (const item of sub.items) {
      const pid = item.productId.toString();
      restockMap.set(pid, (restockMap.get(pid) || 0) + item.quantity);
    }
  }

  const sortedProductIds = Array.from(restockMap.keys()).sort();
  const bulkRestockOps = sortedProductIds.map((productId) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(productId) },
      update: {
        $inc: {
          stock: restockMap.get(productId)!,
          salesCount: -restockMap.get(productId)!,
        },
      },
    },
  }));

  await PaymentTransaction.updateOne(
    { orderCode },
    { $set: { status: "FAILED", gatewayResponse } },
    { session },
  );
  await Order.updateOne(
    { orderCode },
    { $set: { status: "CANCELLED" } },
    { session },
  );
  await SubOrder.updateMany(
    { orderCode },
    { $set: { status: "CANCELLED" } },
    { session },
  );

  if (bulkRestockOps.length > 0) {
    await Product.bulkWrite(bulkRestockOps, { session });
    return true;
  }
  return false;
};
