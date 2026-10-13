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

// model
import Product from "@/models/products.models";

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
