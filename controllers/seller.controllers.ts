import { Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";

// interface & config
import { AccountRequest } from "@/interfaces/request.interfaces";
import { redisClient } from "@/config/redis.config";
import { HOME_CACHE_KEYS } from "@/config/homeCacheKey.config";

// queue & utils
import { triggerFullRevalidate } from "@/utils/revalidateFE.utils";
import { fileCleanupQueue } from "@/queues/fileCleanup.queue";

// helper
import { generateUploadSignature } from "@/helpers/cloudinary.helper";

// model
import Product from "@/models/products.models";
import Categories from "@/models/categories.models";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getSellerProducts = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const { tab = "all", page = "1", limit = "10", search = "" } = req.query;
    const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNumber = Math.min(
      50,
      Math.max(1, parseInt(limit as string, 10) || 10),
    );
    const skip = (pageNumber - 1) * limitNumber;

    const baseFilter: Record<string, any> = {
      seller: new mongoose.Types.ObjectId(userId),
      deleted: false,
    };

    if (typeof search === "string" && search.trim() !== "") {
      const keyword = escapeRegex(search.trim());
      baseFilter.$or = [
        { name: { $regex: keyword, $options: "i" } },
        { brand: { $regex: keyword, $options: "i" } },
      ];
    }

    let tabFilter: Record<string, any> = {};
    if (tab === "active") {
      tabFilter = { isActive: true, stock: { $gt: 0 } };
    } else if (tab === "out_of_stock") {
      tabFilter = { isActive: true, stock: { $lte: 0 } };
    } else if (tab === "hidden") {
      tabFilter = { isActive: false };
    }

    const finalQuery = { ...baseFilter, ...tabFilter };

    const [products, tabCounts] = await Promise.all([
      Product.find(finalQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .select("-description")
        .lean(),

      Product.aggregate([
        { $match: baseFilter },
        {
          $facet: {
            all: [{ $count: "count" }],
            active: [
              { $match: { isActive: true, stock: { $gt: 0 } } },
              { $count: "count" },
            ],
            out_of_stock: [
              { $match: { isActive: true, stock: { $lte: 0 } } },
              { $count: "count" },
            ],
            hidden: [{ $match: { isActive: false } }, { $count: "count" }],
          },
        },
      ]),
    ]);

    const formatCount = (facetResult: any[]) => facetResult?.[0]?.count || 0;
    const counters = {
      all: formatCount(tabCounts[0]?.all),
      active: formatCount(tabCounts[0]?.active),
      out_of_stock: formatCount(tabCounts[0]?.out_of_stock),
      hidden: formatCount(tabCounts[0]?.hidden),
    };

    const currentTabCount =
      counters[tab as keyof typeof counters] ?? counters.all;
    const totalPages = Math.max(1, Math.ceil(currentTabCount / limitNumber));

    res.status(200).json({
      code: "success",
      message: "Lấy danh sách thành công",
      data: {
        items: products,
        counters,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          totalItems: currentTabCount,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error("[Get Seller Products Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

const updateProductSchema = z.object({
  name: z.string().trim().min(1).optional(),
  price: z.number().min(0).optional(),
  originalPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        publicId: z.string().min(1),
      }),
    )
    .min(1)
    .max(9)
    .optional(),
});

export const updateSellerProduct = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { id: productId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res.status(400).json({ code: "error", message: "Yêu cầu không hợp lệ." });
      return;
    }

    const parseResult = updateProductSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
      });
      return;
    }
    const updateData = parseResult.data;

    const oldProduct = await Product.findOne({
      _id: productId,
      seller: userId,
      deleted: false,
    })
      .select("images price name isActive stock isFeatured slug")
      .lean();

    if (!oldProduct) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không tồn tại hoặc không có quyền thao tác.",
      });
      return;
    }

    await Product.updateOne(
      { _id: productId },
      { $set: updateData },
      { runValidators: true },
    );

    res.status(200).json({
      code: "success",
      message: "Cập nhật sản phẩm thành công",
    });

    //  thuật toán delta comparison
    const oldImages = oldProduct.images || [];
    if (updateData.images) {
      const newPublicIds = new Set(
        updateData.images.map((img) => img.publicId),
      );

      const deletedPublicIds = oldImages
        .filter((oldImg: any) => !newPublicIds.has(oldImg.publicId))
        .map((img: any) => img.publicId);

      if (deletedPublicIds.length > 0) {
        const cleanupJobs = deletedPublicIds.map((publicId) => ({
          name: `delete-cloudinary-image-${productId}`,
          data: { publicId },
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
          },
        }));

        fileCleanupQueue.addBulk(cleanupJobs).catch(console.error);
      }
    }
    if (oldProduct.slug) {
      triggerFullRevalidate(`product-${oldProduct.slug}`).catch(console.error);
    }

    const isPriceChanged =
      updateData.price !== undefined && oldProduct.price !== updateData.price;
    const isNameChanged =
      updateData.name !== undefined && oldProduct.name !== updateData.name;

    const oldCoverUrl = oldImages[0]?.url;
    const newCoverUrl = updateData.images?.[0]?.url;
    const isCoverImageChanged =
      newCoverUrl !== undefined && oldCoverUrl !== newCoverUrl;

    const oldStock = oldProduct.stock ?? 0;
    const newStock =
      updateData.stock !== undefined ? updateData.stock : oldStock;
    const isStockDrained = oldStock > 0 && newStock <= 0;
    const isRestocked = oldStock <= 0 && newStock > 0;

    const oldActive = oldProduct.isActive ?? false;
    const newActive =
      updateData.isActive !== undefined ? updateData.isActive : oldActive;
    const isDeactivated = oldActive === true && newActive === false;
    const isReactivated = oldActive === false && newActive === true;

    const shouldPurgeHomeCache =
      isPriceChanged ||
      isNameChanged ||
      isCoverImageChanged ||
      isStockDrained ||
      isRestocked ||
      isDeactivated ||
      isReactivated;

    if (shouldPurgeHomeCache) {
      triggerFullRevalidate(
        "home-products",
        [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
        2,
      ).catch(console.error);
    }
  } catch (error) {
    console.error("[Update Seller Product Error]:", error);
    if (!res.headersSent) {
      res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
    }
  }
};

export const getProductUploadSignature = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const throttleKey = `throttle:product_upload_sig:${userId}`;
    const requests = await redisClient.incr(throttleKey);

    if (requests === 1) {
      await redisClient.expire(throttleKey, 60);
    }

    if (requests > 10) {
      res.status(429).json({
        code: "error",
        message: "Thao tác quá nhanh. Vui lòng đợi 1 phút để tiếp tục upload.",
      });
      return;
    }

    const folderName = `Products/user_${userId}`;

    const tags = ["temporary_upload", `user_${userId}`];

    const uploadData = generateUploadSignature(folderName, tags);

    res.status(200).json({
      code: "success",
      message: "Tạo signature thành công.",
      data: uploadData,
    });
  } catch (error) {
    console.error("[Get Product Upload Signature Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

const baseProductSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên sản phẩm").max(200),
  category: z.string().regex(/^[0-9a-fA-F]{24}$/, "Danh mục không hợp lệ"),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        publicId: z.string().min(1),
      }),
    )
    .min(1, "Sản phẩm phải có ít nhất 1 hình ảnh")
    .max(9, "Tối đa 9 hình ảnh"),
  isActive: z.boolean().default(false),
});

const draftProductSchema = baseProductSchema.extend({
  brand: z.string().trim().optional().default("No Brand"),
  price: z.number().min(0).optional().default(0),
  originalPrice: z.number().min(0).optional().default(0),
  stock: z.number().int().min(0).optional().default(0),
  condition: z.number().min(0).max(100).optional().default(100),
  gender: z
    .enum(["men", "women", "unisex", "kids"])
    .optional()
    .default("unisex"),
  size: z.string().trim().optional().default(""),
  colors: z.array(z.string().trim()).optional().default([]),
  material: z.string().trim().optional().default(""),
  description: z.string().trim().optional().default(""),
});

const publishProductSchema = baseProductSchema.extend({
  brand: z.string().trim().min(1, "Vui lòng nhập thương hiệu"),
  price: z.number().min(1000, "Giá bán tối thiểu 1.000đ"),
  originalPrice: z.number().min(0).optional().default(0),
  stock: z.number().int().min(1, "Tồn kho phải lớn hơn 0 để đăng bán"),
  condition: z.number().min(0).max(100).default(100),
  gender: z.enum(["men", "women", "unisex", "kids"]).default("unisex"),
  size: z.string().trim().min(1, "Vui lòng chọn size").default("FreeSize"),
  colors: z.array(z.string().trim()).min(1, "Vui lòng chọn ít nhất 1 màu"),
  material: z.string().trim().optional().default(""),
  description: z.string().trim().min(10, "Mô tả sản phẩm quá ngắn"),
});

export const createSellerProduct = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  const rollbackUploadedImages = (imagesPayload?: any[]) => {
    if (imagesPayload && Array.isArray(imagesPayload)) {
      const publicIds = imagesPayload
        .map((img: any) => img.publicId)
        .filter(Boolean);
      if (publicIds.length > 0) {
        const cleanupJobs = publicIds.map((publicId: string) => ({
          name: `rollback-cloudinary-image`,
          data: { publicId },
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
          },
        }));
        fileCleanupQueue.addBulk(cleanupJobs).catch(console.error);
      }
    }
  };

  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const lockKey = `lock:create_product:${userId}`;
    const isLocked = await redisClient.set(lockKey, "LOCKED", {
      NX: true,
      EX: 3,
    });

    if (!isLocked) {
      rollbackUploadedImages(req.body.images);
      res.status(429).json({
        code: "error",
        message: "Hệ thống đang xử lý, vui lòng không click nhiều lần.",
      });
      return;
    }

    const isPublishing = req.body.isActive === true;
    const schemaToUse = isPublishing
      ? publishProductSchema
      : draftProductSchema;

    const parseResult = schemaToUse.safeParse(req.body);
    if (!parseResult.success) {
      rollbackUploadedImages(req.body.images);

      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
      });
      return;
    }

    const validatedData = parseResult.data;

    const categoryExists = await Categories.exists({
      _id: validatedData.category,
      deleted: false,
    });

    if (!categoryExists) {
      rollbackUploadedImages(req.body.images);

      res.status(400).json({
        code: "error",
        message: "Danh mục không tồn tại hoặc đã bị xóa.",
      });
      return;
    }

    const newProduct = await Product.create({
      ...validatedData,
      seller: userId,
    });

    res.status(201).json({
      code: "success",
      message: isPublishing
        ? "Đăng bán sản phẩm thành công!"
        : "Đã lưu nháp sản phẩm.",
      data: {
        _id: newProduct._id,
        slug: newProduct.slug,
      },
    });
  } catch (error: any) {
    console.error("[Create Seller Product Error]:", error);

    rollbackUploadedImages(req.body.images);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err: any) => err.message,
      );

      if (!res.headersSent) {
        res.status(400).json({
          code: "error",
          message: messages.join(", "),
        });
      }
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
    }
  }
};

export const deleteSellerProduct = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    const { id: productId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res.status(400).json({ code: "error", message: "Yêu cầu không hợp lệ." });
      return;
    }

    const product = await Product.findOne({
      _id: productId,
      seller: userId,
      deleted: false,
    }).lean();

    if (!product) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không tồn tại hoặc bạn không có quyền xóa.",
      });
      return;
    }

    await Product.updateOne(
      { _id: productId },
      {
        $set: {
          deleted: true,
          isActive: false,
          stock: 0,
        },
      },
    );

    res.status(200).json({
      code: "success",
      message: "Đã xóa sản phẩm thành công.",
    });

    if (product.slug) {
      triggerFullRevalidate(`product-${product.slug}`).catch(console.error);
    }

    if (product.isActive && product.stock > 0) {
      triggerFullRevalidate(
        "home-products",
        [HOME_CACHE_KEYS.FEATURED, HOME_CACHE_KEYS.DAILY_DISCOVER],
        2,
      ).catch(console.error);
    }
  } catch (error: any) {
    console.error("Delete Seller Product Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
    }
  }
};
