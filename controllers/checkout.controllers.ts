import { Response } from "express";

// uuid
import { v4 as uuidv4 } from "uuid";

// mongoose
import mongoose from "mongoose";

// config & interfaces
import { redisClient } from "@/config/redis.config";
import { AccountRequest } from "@/interfaces/request.interfaces";

// models
import Product from "@/models/products.models";
import { checkoutPayloadSchema } from "@/helpers/checkoutPayloadSchema.helper";

export const initCheckoutSession = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    console.log(req.body);
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = checkoutPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
      });
      return;
    }

    const { items } = parseResult.data;
    const productObjectIds = items.map(
      (i) => new mongoose.Types.ObjectId(i.productId),
    );

    const dbProducts = await Product.find(
      {
        _id: { $in: productObjectIds },
        deleted: false,
        isActive: true,
        stock: { $gt: 0 },
      },
      {
        _id: 1,
        name: 1,
        slug: 1,
        price: 1,
        stock: 1,
        seller: 1,
        images: { $slice: 1 },
      },
    )
      //  lấy thông tin Seller
      .populate("seller", "fullName avatar")
      .lean();

    if (dbProducts.length === 0) {
      res.status(400).json({
        code: "error",
        message: "Các sản phẩm đã hết hàng hoặc không tồn tại.",
      });
      return;
    }

    // Index DB Products thành Hash Map để đạt O(1) lookup
    const dbProductMap = new Map<string, (typeof dbProducts)[0]>();
    for (const p of dbProducts) {
      dbProductMap.set(p._id.toString(), p);
    }

    // gom nhóm Shop (C2C)
    interface SubOrderItem {
      productId: string;
      name: string;
      slug: string;
      image: string;
      price: number;
      quantity: number;
      itemTotal: number;
    }

    interface ShopGroup {
      sellerInfo: { id: string; fullName: string; avatar: string };
      items: SubOrderItem[];
      shopSubTotal: number;
      shippingFee: number;
      shippingMethod: null | string;
    }

    const shopMap = new Map<string, ShopGroup>();
    let cartSubTotal = 0;

    for (const feItem of items) {
      const dbProduct = dbProductMap.get(feItem.productId);
      if (!dbProduct) continue;

      // Không cho mua vượt quá tồn kho hiện tại
      const validQuantity = Math.min(feItem.quantity, dbProduct.stock);
      if (validQuantity <= 0) continue;

      // Trừ trực tiếp vào RAM để chặn request gửi trùng ID lừa hệ thống
      dbProduct.stock -= validQuantity;

      const itemTotal = Math.round(dbProduct.price * validQuantity);
      cartSubTotal += itemTotal;

      const sellerData = dbProduct.seller as any;
      const sellerId = sellerData._id.toString();

      const formattedItem: SubOrderItem = {
        productId: dbProduct._id.toString(),
        name: dbProduct.name,
        slug: dbProduct.slug,
        image: dbProduct.images?.[0] || "",
        price: dbProduct.price,
        quantity: validQuantity,
        itemTotal,
      };

      const existingShop = shopMap.get(sellerId);
      if (existingShop) {
        existingShop.items.push(formattedItem);
        existingShop.shopSubTotal += itemTotal;
      } else {
        shopMap.set(sellerId, {
          sellerInfo: {
            id: sellerId,
            fullName: sellerData.fullName || "Tintage Shop",
            avatar: sellerData.avatar || "",
          },
          items: [formattedItem],
          shopSubTotal: itemTotal,
          shippingFee: 0,
          shippingMethod: null,
        });
      }
    }

    const subOrders = Array.from(shopMap.values());
    if (subOrders.length === 0) {
      res
        .status(400)
        .json({ code: "error", message: "Sản phẩm không còn khả dụng." });
      return;
    }

    // Cấu trúc Session
    const checkoutToken = `chk_${uuidv4().replace(/-/g, "")}`;
    const checkoutSessionData = {
      userId,
      subOrders,
      financials: {
        cartSubTotal,
        totalShippingFee: 0,
        voucherDiscount: 0,
        grandTotal: cartSubTotal,
      },
      shippingAddress: null,
      createdAt: Date.now(),
    };

    //  Lưu Redis
    await redisClient.set(
      `checkout_session:${checkoutToken}`,
      JSON.stringify(checkoutSessionData),
      { EX: 1800 },
    );

    res.status(200).json({
      code: "success",
      message: "Khởi tạo phiên thanh toán thành công",
      data: { checkoutToken },
    });
  } catch (error) {
    console.error("[Init Checkout Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};
