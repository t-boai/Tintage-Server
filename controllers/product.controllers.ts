import { Request, Response } from "express";
import mongoose from "mongoose";

// helpers
import { isActuallyNew } from "@/helpers/isActuallyNew.helper";
import { formatJoinedTime } from "@/helpers/formatJoinedTime";

// interfaces
import { AccountRequest } from "@/interfaces/request.interfaces";

// models
import Heart from "@/models/hearts.models";
import Product from "@/models/products.models";

export const productDetail = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const { slugOrId } = req.params;

    const userId = req.account?.id;

    if (!slugOrId || slugOrId === "undefined" || slugOrId === "null") {
      res.status(400).json({
        code: "error",
        message: "Thiếu định danh sản phẩm.",
      });
      return;
    }

    // Tìm theo slug hoặc id
    const isObjectId = mongoose.Types.ObjectId.isValid(`${slugOrId}`);
    const matchQuery: any = {
      deleted: false,
      isActive: true,
      ...(isObjectId
        ? { _id: new mongoose.Types.ObjectId(`${slugOrId}`) }
        : { slug: slugOrId }),
    };

    // Query chi tiết kết hợp populate Category & Seller
    const product = await Product.findOne(matchQuery)
      .populate({
        path: "category",
        select: "_id name slug ancestors",
      })
      .populate({
        path: "seller",
        select:
          "_id fullName slug avatar isVerifiedSeller sellerRole sellerRating createdAt",
      })
      .lean();

    if (!product) {
      res.status(404).json({
        code: "error",
        message: "Sản phẩm không tồn tại hoặc đã ngừng kinh doanh.",
      });
      return;
    }

    // Background Non-blocking: Tăng viewsCount bất đồng bộ
    Product.updateOne({ _id: product._id }, { $inc: { viewsCount: 1 } }).catch(
      (err) => console.error("Lỗi tăng lượt xem: ", err),
    );

    // Check Thả tim
    let isLiked = false;
    if (userId) {
      const heartExist = await Heart.exists({
        user: new mongoose.Types.ObjectId(userId),
        product: product._id,
      });
      isLiked = Boolean(heartExist);
    }

    // Đếm số sản phẩm của Shop
    const sellerId = (product.seller as any)?._id;
    let sellerTotalProducts = 0;
    if (sellerId) {
      sellerTotalProducts = await Product.countDocuments({
        seller: sellerId,
        deleted: false,
        isActive: true,
        stock: { $gt: 0 },
      });
    }

    // categories (breadcrumbs)
    const categoryData = product.category as any;
    let breadcrumbs: any[] = [];

    if (categoryData) {
      // Đưa tổ tiên (nếu có) vào mảng trước
      if (categoryData.ancestors && categoryData.ancestors.length > 0) {
        breadcrumbs = categoryData.ancestors.map((anc: any) => ({
          id: anc._id?.toString(),
          name: anc.name,
          slug: anc.slug,
        }));
      }

      // Đưa danh mục hiện tại vào cuối mảng
      breadcrumbs.push({
        id: categoryData._id?.toString(),
        name: categoryData.name,
        slug: categoryData.slug,
      });
    }

    const productFinal = {
      id: product._id.toString(),
      brand: product.brand,
      name: product.name,
      slug: product.slug,
      price: product.price,
      originalPrice: product.originalPrice || 0,
      discount: product.discount || 0,
      condition: product.condition ? `Độ mới ${product.condition}%` : null,
      size: product.size || null,
      images: product.images || [],
      location: product.location,
      description: product.description || "",
      material: product.material || "",
      stock: product.stock,
      viewsCount: (product.viewsCount || 0) + 1,
      likesCount: product.likesCount || 0,
      salesCount: product.salesCount || 0,
      isNew: isActuallyNew(product.isNewProduct, product.createdAt),
      isLiked,
      categories: breadcrumbs.length > 0 ? breadcrumbs : null,
      seller: product.seller
        ? {
            slug: (product.seller as any).slug,
            fullName: (product.seller as any).fullName,
            avatar: (product.seller as any).avatar || "",
            isVerifiedSeller: (product.seller as any).isVerifiedSeller || false,
            sellerRole: (product.seller as any).sellerRole || "individual",
            sellerRating: (product.seller as any).sellerRating || 5.0,
            reviewCount: (product.seller as any).reviewCount || 0,
            totalProducts: sellerTotalProducts,
            joinedAt: (product.seller as any).createdAt,
            joinedTime: formatJoinedTime((product.seller as any).createdAt),
          }
        : null,
      createdTime: formatJoinedTime(product.createdAt),
    };

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=120",
    );
    res.status(200).json({
      code: "success",
      message: "Lấy chi tiết sản phẩm thành công",
      data: productFinal,
    });
  } catch (error) {
    console.error("Lỗi sản phẩm chi tiết: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const recommendations = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      24,
      Math.max(1, parseInt(req.query.limit as string, 10) || 12),
    );
    const skip = (page - 1) * limit;

    const { categoryId, excludeId, sellerId } = req.query;

    let seedNum = 0;
    if (excludeId && mongoose.Types.ObjectId.isValid(`${excludeId}`)) {
      const hex = excludeId.toString().slice(-5);
      seedNum = parseInt(hex, 16) || 0;
    }

    const ROTATION_WINDOW_SECONDS = 120;
    const now = Date.now();
    const timeBucket = Math.floor(now / (ROTATION_WINDOW_SECONDS * 1000));
    const secondsRemaining =
      ROTATION_WINDOW_SECONDS -
      (Math.floor(now / 1000) % ROTATION_WINDOW_SECONDS);

    const matchStage: any = {
      deleted: false,
      isActive: true,
      stock: { $gt: 0 },
    };

    if (categoryId && mongoose.Types.ObjectId.isValid(`${categoryId}`)) {
      matchStage.category = new mongoose.Types.ObjectId(`${categoryId}`);
    }
    if (sellerId && mongoose.Types.ObjectId.isValid(`${sellerId}`)) {
      matchStage.seller = new mongoose.Types.ObjectId(`${sellerId}`);
    }
    if (excludeId && mongoose.Types.ObjectId.isValid(`${excludeId}`)) {
      matchStage._id = { $ne: new mongoose.Types.ObjectId(`${excludeId}`) };
    }

    const result = await Product.aggregate(
      [
        { $match: matchStage },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [
              {
                $addFields: {
                  rotationScore: {
                    $mod: [
                      {
                        $add: [
                          { $toLong: "$createdAt" },
                          timeBucket * 1103515245,
                          seedNum * 99991,
                        ],
                      },
                      1000000,
                    ],
                  },
                },
              },
              { $sort: { rotationScore: -1, createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: "categories",
                  localField: "category",
                  foreignField: "_id",
                  as: "categoryInfo",
                },
              },
              {
                $unwind: {
                  path: "$categoryInfo",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "seller",
                  foreignField: "_id",
                  as: "sellerInfo",
                },
              },
              {
                $unwind: {
                  path: "$sellerInfo",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 1,
                  brand: 1,
                  name: 1,
                  price: 1,
                  originalPrice: 1,
                  condition: 1,
                  size: 1,
                  material: 1,
                  image: { $arrayElemAt: ["$images", 0] },
                  slug: 1,
                  stock: 1,
                  location: 1,
                  salesCount: 1,
                  likesCount: 1,
                  isNewProduct: 1,
                  createdAt: 1,
                  categoryInfo: { _id: 1, name: 1, slug: 1 },
                  sellerInfo: {
                    _id: 1,
                    slug: 1,
                    fullName: 1,
                    avatar: 1,
                    isVerifiedSeller: 1,
                    sellerRole: 1,
                    sellerRating: 1,
                  },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: true },
    );

    const totalItems = result[0]?.metadata[0]?.total || 0;
    const rawProducts = result[0]?.data || [];
    const totalPages = Math.ceil(totalItems / limit);

    const productsFinal = rawProducts.map((item: any) => ({
      id: item._id.toString(),
      brand: item.brand,
      name: item.name,
      price: item.price,
      originalPrice: item.originalPrice || 0,
      discount: item.discount || 0,
      condition: item.condition ? `Độ mới ${item.condition}%` : null,
      size: item.size || null,
      material: item.material || "",
      isNew: isActuallyNew(item.isNewProduct, item.createdAt),
      image: item.image || "",
      slug: item.slug,
      stock: item.stock,
      location: item.location,
      salesCount: item.salesCount || 0,
      likesCount: item.likesCount || 0,
      category: item.categoryInfo
        ? {
            id: item.categoryInfo._id.toString(),
            name: item.categoryInfo.name,
            slug: item.categoryInfo.slug,
          }
        : null,
      seller: item.sellerInfo
        ? {
            id: item.sellerInfo._id.toString(),
            slug: item.sellerInfo.slug || null,
            fullName: item.sellerInfo.fullName,
            avatar: item.sellerInfo.avatar || "",
            isVerified: item.sellerInfo.isVerifiedSeller || false,
            role: item.sellerInfo.sellerRole || "individual",
            rating: item.sellerInfo.sellerRating || 5.0,
          }
        : null,
    }));

    res.setHeader(
      "Cache-Control",
      `public, max-age=${Math.max(secondsRemaining, 5)}`,
    );

    res.status(200).json({
      code: "success",
      message: "Lấy gợi ý sản phẩm thành công",
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
      },
      data: productsFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy gợi ý sản phẩm:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};
