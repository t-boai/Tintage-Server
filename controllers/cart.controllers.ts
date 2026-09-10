import { Response } from "express";
import mongoose from "mongoose";

// interfaces
import { AccountRequest } from "@/interfaces/request.interfaces";

// models
import Cart from "@/models/carts.models";
import Product from "@/models/products.models";

const MAX_QUANTITY_PER_ITEM = 10;

export const myCart = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;

    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: "items.product",
        select:
          "brand name slug price originalPrice images condition size stock deleted isActive seller",
        populate: {
          path: "seller",
          select: "fullName avatar isVerifiedSeller sellerRole",
        },
      })
      .lean();

    if (!cart || cart.items.length === 0) {
      res.status(200).json({
        code: "success",
        message: "Giỏ hàng trống",
        data: {
          availableItems: [],
          unavailableItems: [],
          totalItems: 0,
          totalAmount: 0,
        },
      });
      return;
    }

    let totalAmount = 0;
    let totalItems = 0;

    const availableItems: any[] = [];
    const unavailableItems: any[] = [];

    cart.items.forEach((cartItem: any) => {
      const p = cartItem.product;

      // Kiểm tra tồn tại trong DB
      const isProductExist = Boolean(p && !p.deleted);
      // Kiểm tra còn khả dụng để mua
      const isAvailable = Boolean(isProductExist && p.isActive && p.stock > 0);

      const formattedProduct = isProductExist
        ? {
            id: p._id.toString(),
            brand: p.brand,
            name: p.name,
            slug: p.slug,
            price: p.price,
            originalPrice: p.originalPrice || 0,
            condition: p.condition ? `Độ mới ${p.condition}%` : null,
            size: p.size || null,
            image: p.images?.[0] || "",
            stock: p.stock ?? 0,
            isActive: p.isActive,
            seller: p.seller
              ? {
                  id: p.seller._id.toString(),
                  fullName: p.seller.fullName,
                  avatar: p.seller.avatar || "",
                  isVerifiedSeller: p.seller.isVerifiedSeller || false,
                  sellerRole: p.seller.sellerRole || "individual",
                  sellerRating: p.seller.sellerRating ?? 5.0,
                }
              : null,
          }
        : null;

      if (isAvailable && formattedProduct) {
        // Nhánh sản phẩm mua được
        const validQuantity = Math.min(cartItem.quantity, p.stock);
        totalAmount += p.price * validQuantity;
        totalItems += validQuantity;

        availableItems.push({
          product: formattedProduct,
          quantity: validQuantity,
        });
      } else {
        // Nhánh sản phẩm đã bán / ẩn / bị gỡ
        unavailableItems.push({
          product: formattedProduct, //  trả info cũ để khách biết món nào đã bán
          reason: !isProductExist
            ? "Sản phẩm đã bị xóa"
            : p.stock === 0
              ? "Đã bán hết"
              : "Tạm ngừng bán",
          quantity: cartItem.quantity,
        });
      }
    });

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    res.status(200).json({
      code: "success",
      message: "Lấy giỏ hàng thành công",
      data: {
        availableItems,
        unavailableItems,
        totalItems,
        totalAmount,
      },
    });
  } catch (error) {
    console.error("Lỗi khi lấy giỏ hàng: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const addToCartPost = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { productId } = req.body;
    let quantity = parseInt(req.body.quantity, 10);

    if (isNaN(quantity) || quantity < 1) {
      quantity = 1;
    }

    if (!mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res.status(400).json({
        code: "error",
        message: "ID Sản phẩm không hợp lệ.",
      });
      return;
    }

    //  Chặn đặt số lượng quá lớn ngay từ request đầu vào
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      res.status(400).json({
        code: "error",
        errorType: "BULK_PURCHASE_REQUIRED",
        message: `Bạn chỉ có thể đặt tối đa ${MAX_QUANTITY_PER_ITEM} sản phẩm trên hệ thống. Nếu muốn mua sỉ/số lượng lớn, vui lòng liên hệ trực tiếp với người bán.`,
      });
      return;
    }

    // Tìm sản phẩm trong DB (Check tồn kho và trạng thái hoạt động)
    const product = await Product.findOne({
      _id: productId,
      isActive: true,
      deleted: false,
    })
      .select("stock")
      .lean();

    if (!product) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không tồn tại hoặc đã bị ẩn.",
      });
      return;
    }

    if (product.stock < 1) {
      res.status(400).json({
        code: "error",
        message: "Rất tiếc, sản phẩm này đã hết hàng.",
      });
      return;
    }

    // Tìm giỏ hàng của User
    const cart = await Cart.findOne({ user: userId });

    // User chưa có giỏ hàng (Tạo mới)
    if (!cart) {
      if (quantity > product.stock) {
        res.status(400).json({
          code: "error",
          message: `Số lượng sản phẩm hiện chỉ còn lại ${product.stock} trong kho.`,
        });
        return;
      }

      await Cart.create({
        user: userId,
        items: [{ product: productId, quantity }],
      });

      res.status(200).json({
        code: "success",
        message: "Đã thêm vào giỏ hàng <3",
      });
      return;
    }

    // User đã có giỏ hàng -> Kiểm tra sản phẩm đã tồn tại trong giỏ chưa
    const existItemIndex = cart.items.findIndex(
      (item) => item.product.toString() === productId.toString(),
    );

    if (existItemIndex > -1) {
      const currentQuantity = cart.items[existItemIndex].quantity;
      const newQuantity = currentQuantity + quantity;

      // Xử lý stock = 1
      if (product.stock === 1) {
        res.status(400).json({
          code: "error",
          message: "Sản phẩm này đã có trong giỏ hàng của bạn.",
        });
        return;
      }

      // Xử lý vượt ngưỡng mua sỉ / số lượng lớn
      if (newQuantity > MAX_QUANTITY_PER_ITEM) {
        res.status(400).json({
          code: "error",
          errorType: "BULK_PURCHASE_REQUIRED",
          message: `Tổng số lượng trong giỏ sẽ vượt quá ${MAX_QUANTITY_PER_ITEM} món. Để mua sỉ số lượng lớn hơn, vui lòng liên hệ người bán.`,
        });
        return;
      }

      // Xử lý vượt tồn kho thực tế
      if (newQuantity > product.stock) {
        res.status(400).json({
          code: "error",
          message: `Bạn đã có ${currentQuantity} chiếc trong giỏ. Kho chỉ còn ${product.stock} chiếc.`,
        });
        return;
      }

      // Cập nhật số lượng (Dùng Positional Operator $ )
      await Cart.updateOne(
        { user: userId, "items.product": productId },
        { $set: { "items.$.quantity": newQuantity } },
      );
    } else {
      // Sản phẩm chưa có trong giỏ
      if (quantity > product.stock) {
        res.status(400).json({
          code: "error",
          message: `Số lượng sản phẩm hiện chỉ còn lại ${product.stock} trong kho.`,
        });
        return;
      }

      // Atomic push item vào mảng giỏ hàng
      await Cart.updateOne(
        { user: userId },
        { $push: { items: { product: productId, quantity } } },
      );
    }

    res.status(200).json({
      code: "success",
      message: "Đã thêm vào giỏ hàng <3",
    });
  } catch (error) {
    console.error("[Add To Cart Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const updateQuantityPatch = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { productId } = req.params;
    const quantity = parseInt(req.body.quantity, 10);

    if (!mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res.status(400).json({
        code: "error",
        message: "ID Sản phẩm không hợp lệ.",
      });
      return;
    }

    const targetProductObjectId = new mongoose.Types.ObjectId(`${productId}`);

    // Nếu FE truyền quantity <= 0 -> Tự động  Xóa món đồ khỏi giỏ
    if (isNaN(quantity) || quantity <= 0) {
      await Cart.updateOne(
        { user: userId },
        { $pull: { items: { product: targetProductObjectId } } },
      );

      res.status(200).json({
        code: "success",
        message: "Đã xóa sản phẩm khỏi giỏ hàng.",
      });
      return;
    }

    // Kiểm tra giới hạn số lượng tối đa
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      res.status(400).json({
        code: "error",
        errorType: "BULK_PURCHASE_REQUIRED",
        message: `Tối đa ${MAX_QUANTITY_PER_ITEM} sản phẩm. Vui lòng liên hệ shop để mua số lượng lớn.`,
      });
      return;
    }

    // Kiểm tra tồn kho của sản phẩm
    const product = await Product.findOne({
      _id: targetProductObjectId,
      isActive: true,
      deleted: false,
    })
      .select("stock")
      .lean();

    if (!product || product.stock < quantity) {
      res.status(400).json({
        code: "error",
        message: `Rất tiếc, kho chỉ còn ${product?.stock || 0} sản phẩm.`,
      });
      return;
    }

    // Cập nhật số lượng trực tiếp
    const result = await Cart.updateOne(
      { user: userId, "items.product": targetProductObjectId },
      { $set: { "items.$.quantity": quantity } },
    );

    if (result.matchedCount === 0) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không có trong giỏ hàng.",
      });
      return;
    }

    res.status(200).json({
      code: "success",
      message: "Cập nhật số lượng thành công.",
    });
  } catch (error) {
    console.error("Lỗi khi update số lượng sản phẩm: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const deleteItem = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res.status(400).json({
        code: "error",
        message: "ID Sản phẩm không hợp lệ.",
      });
      return;
    }

    const targetProductObjectId = new mongoose.Types.ObjectId(`${productId}`);

    // Dùng $pull: Atomic operation gắp bỏ trực tiếp phần tử ra khỏi mảng
    const result = await Cart.updateOne(
      { user: userId },
      {
        $pull: {
          items: { product: targetProductObjectId },
        },
      },
    );

    if (result.modifiedCount === 0) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không có trong giỏ hàng.",
      });
      return;
    }

    res.status(200).json({
      code: "success",
      message: "Đã xóa sản phẩm khỏi giỏ hàng <3",
    });
  } catch (error) {
    console.error("Lỗi khi xóa sản phẩm: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const deleteMultipleItems = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({
        code: "error",
        message: "Danh sách sản phẩm cần xóa không hợp lệ.",
      });
      return;
    }

    // Chuyể sang ObjectId
    const validObjectIds = productIds
      .filter((id: any) => mongoose.Types.ObjectId.isValid(`${id}`))
      .map((id: any) => new mongoose.Types.ObjectId(`${id}`));

    if (validObjectIds.length === 0) {
      res.status(400).json({
        code: "error",
        message: "Không có ID sản phẩm nào hợp lệ để xóa.",
      });
      return;
    }

    const result = await Cart.updateOne(
      { user: userId },
      {
        $pull: {
          items: { product: { $in: validObjectIds } },
        },
      },
    );

    if (result.modifiedCount === 0) {
      res.status(404).json({
        code: "error",
        message: "Các sản phẩm này không tồn tại trong giỏ hàng.",
      });
      return;
    }

    res.status(200).json({
      code: "success",
      message: `Đã xóa ${validObjectIds.length} sản phẩm khỏi giỏ hàng.`,
    });
  } catch (error) {
    console.error("Lỗi khi xóa nhiều sản phẩm: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const clearCart = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;

    await Cart.updateOne({ user: userId }, { $set: { items: [] } });

    res.status(200).json({
      code: "success",
      message: "Đã làm trống giỏ hàng thành công.",
    });
  } catch (error) {
    console.error("[Clear Cart Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const clearUnavailable = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart) {
      res.status(200).json({ code: "success", message: "Giỏ hàng trống" });
      return;
    }

    // Chỉ giữ lại những món còn hàng và đang active
    const validItems = cart.items.filter((item: any) => {
      const p = item.product;
      return p && !p.deleted && p.isActive && p.stock > 0;
    });

    await Cart.updateOne(
      { user: userId },
      {
        $set: {
          items: validItems.map((i: any) => ({
            product: i.product._id,
            quantity: i.quantity,
          })),
        },
      },
    );

    res.status(200).json({
      code: "success",
      message: "Đã dọn dẹp các sản phẩm hết hàng khỏi giỏ <3",
    });
  } catch (error) {
    console.error("[Clear Unavailable Items Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};
