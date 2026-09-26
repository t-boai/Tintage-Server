import { Response } from "express";

// uuid
import { v4 as uuidv4 } from "uuid";

// mongoose
import mongoose from "mongoose";

// z & crypto
import z from "zod";

// config & interfaces
import { redisClient } from "@/config/redis.config";
import { CHECKOUT_TOKEN_REGEX } from "@/config/check-token-regex.config";
import { AccountRequest } from "@/interfaces/request.interfaces";
import { ShippingOptionInfo } from "@/interfaces/ishipping.interfaces";

// helpers & utils
import { checkoutPayloadSchema } from "@/helpers/checkoutPayloadSchema.helper";
import { generateShippingOptionsAsync } from "@/helpers/shippingCalculator.helper";

// models
import Product from "@/models/products.models";
import AccountUser from "@/models/account-user.model";

export const initCheckoutSession = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
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
        size: 1,
        location: 1,
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
      size: string;
    }

    interface ShopGroup {
      sellerInfo: { id: string; fullName: string; avatar: string };
      items: SubOrderItem[];
      shopSubTotal: number;
      shippingFee: number;
      shopProvince: string;
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
        size: dbProduct.size || "Mặc định",
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
          shopProvince: dbProduct.location || "Hồ Chí Minh",
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

export const getCheckoutSession = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    // Chống browser/proxy cache thông tin tài chính nhạy cảm
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    const userId = req.account?.id;
    const { token } = req.params;

    if (!userId) {
      res.status(401).json({
        code: "error",
        message: "Vui lòng đăng nhập.",
      });
      return;
    }

    // Chặn ngay các request rác/tấn công brute-force trước khi chạm tới Redis
    if (!token || !CHECKOUT_TOKEN_REGEX.test(`${token}`)) {
      res.status(400).json({
        code: "error",
        message: "Mã phiên thanh toán không hợp lệ.",
      });
      return;
    }

    const redisKey = `checkout_session:${token}`;

    const rawResults = await redisClient
      .multi()
      .get(redisKey)
      .ttl(redisKey)
      .exec();

    const [sessionDataString, ttlRemaining] = (rawResults as unknown as [
      string | null,
      number,
    ]) || [null, -1];

    // Nếu key không tồn tại hoặc đã hết hạn
    if (!sessionDataString || ttlRemaining <= 0) {
      res.status(404).json({
        code: "error",
        message:
          "Phiên thanh toán đã hết hạn hoặc không tồn tại. Vui lòng quay lại giỏ hàng.",
      });
      return;
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionDataString);
    } catch (parseError) {
      console.error(`[Redis Corrupted Data] Key: ${redisKey}`, parseError);
      res.status(500).json({
        code: "error",
        message: "Dữ liệu phiên thanh toán không hợp lệ. Vui lòng thử lại.",
      });
      return;
    }

    //  Kiểm tra  sở hữu (Chống IDOR - Cướp đơn hàng)
    if (sessionData.userId !== userId) {
      res.status(403).json({
        code: "error",
        message: "Bạn không có quyền truy cập phiên thanh toán này.",
      });
      return;
    }

    //  tách userId  khỏi payload trả về client
    const { userId: _, ...safeSession } = sessionData;

    // Fallback format
    const subOrders = (safeSession.subOrders || []).map((so: any) => ({
      ...so,
      items: (so.items || []).map((item: any) => ({
        ...item,
        size: item.size || "Mặc định",
      })),
    }));

    res.status(200).json({
      code: "success",
      message: "Lấy dữ liệu phiên thanh toán thành công.",
      data: {
        ...safeSession,
        subOrders,
        expiresIn: ttlRemaining,
      },
    });
  } catch (error) {
    console.error("[Get Checkout Session Error]:", error);
    res.status(500).json({
      code: "error",
      message: "Hệ thống đang quá tải, vui lòng thử lại sau.",
    });
  }
};

const updateShippingSchema = z.object({
  addressId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "ID Địa chỉ không hợp lệ.",
  }),
  shippingMethods: z
    .record(z.string().trim(), z.enum(["STANDARD", "EXPRESS"]))
    .optional()
    .default({}),
});

export const updateCheckoutShippingPatch = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { token } = req.params;

    if (!userId || !CHECKOUT_TOKEN_REGEX.test(`${token}`)) {
      res.status(400).json({ code: "error", message: "Yêu cầu không hợp lệ." });
      return;
    }

    const parseResult = updateShippingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message ||
          "Dữ liệu vận chuyển không hợp lệ.",
      });
      return;
    }

    const { addressId, shippingMethods } = parseResult.data;
    const redisKey = `checkout_session:${token}`;

    const sessionString = await redisClient.get(redisKey);
    if (!sessionString) {
      res.status(404).json({
        code: "error",
        message: "Phiên thanh toán đã hết hạn.",
      });
      return;
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionString);
    } catch {
      res.status(500).json({
        code: "error",
        message: "Dữ liệu phiên không hợp lệ.",
      });
      return;
    }

    if (sessionData.userId !== userId) {
      res
        .status(403)
        .json({ code: "error", message: "Bạn không có quyền truy cập." });
      return;
    }

    // Tối ưu tìm địa chỉ (Ưu tiên cache trong Session)
    let selectedAddress = null;
    if (
      sessionData.shippingAddress &&
      sessionData.shippingAddress._id?.toString() === addressId
    ) {
      selectedAddress = sessionData.shippingAddress;
    } else {
      const userWithAddress = await AccountUser.findOne(
        { _id: userId, "address._id": new mongoose.Types.ObjectId(addressId) },
        { "address.$": 1 },
      ).lean();
      selectedAddress = userWithAddress?.address?.[0];
    }

    if (!selectedAddress) {
      res.status(404).json({
        code: "error",
        message: "Không tìm thấy địa chỉ giao hàng hợp lệ.",
      });
      return;
    }

    //  Chạy tính cước song song cho các Shop
    const resolvedResults = await Promise.all(
      sessionData.subOrders.map(async (subOrder: any) => {
        const sellerId = subOrder.sellerInfo.id;
        const requestedMethod =
          shippingMethods[sellerId] || subOrder.shippingMethod || "STANDARD";
        const shopProvince =
          subOrder.shopProvince || subOrder.items[0]?.location || "TP.HCM";
        const shopDistrict = subOrder.shopDistrict || "Quận 1";

        const availableShippingOptions = await generateShippingOptionsAsync(
          shopProvince,
          shopDistrict,
          selectedAddress.province,
          selectedAddress.district,
          subOrder.shopSubTotal,
        );

        let selectedOption =
          availableShippingOptions.find((opt) => opt.id === requestedMethod) ||
          availableShippingOptions.find((opt) => opt.id === "STANDARD") ||
          availableShippingOptions[0];

        return {
          sellerId,
          updatedSubOrder: {
            ...subOrder,
            shippingMethod: selectedOption.id,
            shippingFee: selectedOption.originalPrice,
            shippingDiscount: selectedOption.discount,
            finalShippingFee: selectedOption.finalPrice,
          },
          options: availableShippingOptions,
          fee: selectedOption.originalPrice,
          discount: selectedOption.discount,
        };
      }),
    );

    let totalShippingFee = 0;
    let totalShippingDiscount = 0;
    const updatedSubOrders: any[] = [];
    const clientOptionsMap: Record<string, ShippingOptionInfo[]> = {};

    for (const resItem of resolvedResults) {
      updatedSubOrders.push(resItem.updatedSubOrder);
      clientOptionsMap[resItem.sellerId] = resItem.options;
      totalShippingFee += resItem.fee;
      totalShippingDiscount += resItem.discount;
    }

    sessionData.subOrders = updatedSubOrders;
    sessionData.shippingAddress = selectedAddress;

    const currentVoucherDiscount = sessionData.financials.voucherDiscount || 0;
    sessionData.financials = {
      ...sessionData.financials,
      totalShippingFee,
      totalShippingDiscount,
      voucherDiscount: currentVoucherDiscount,
      grandTotal: Math.max(
        0,
        sessionData.financials.cartSubTotal +
          totalShippingFee -
          totalShippingDiscount -
          currentVoucherDiscount,
      ),
    };

    sessionData.version = (sessionData.version || 0) + 1;

    //  Lưu lại Redis (bảo toàn TTL, không availableShippingOptions vào RAM)
    const setResult = await redisClient.set(
      redisKey,
      JSON.stringify(sessionData),
      {
        XX: true,
        KEEPTTL: true,
      },
    );

    if (!setResult) {
      res.status(404).json({
        code: "error",
        message:
          "Phiên thanh toán đã hết hạn trong lúc xử lý. Vui lòng thử lại.",
      });
      return;
    }

    const { userId: _, ...clientPayload } = sessionData;
    clientPayload.subOrders = clientPayload.subOrders.map((so: any) => ({
      ...so,
      items:
        so.items?.map((item: any) => ({
          ...item,
          size: item.size || "Mặc định",
        })) || [],
      availableShippingOptions: clientOptionsMap[so.sellerInfo.id] || [],
    }));

    res.status(200).json({
      code: "success",
      message: "Cập nhật phí vận chuyển thành công.",
      data: clientPayload,
    });
  } catch (error) {
    console.error("Lỗi update shipping:", error);
    res.status(500).json({
      code: "error",
      message: "Hệ thống đang quá tải, vui lòng thử lại sau.",
    });
  }
};
