import { DiscountPercent } from "@/helpers/discountPercent.helper";
import { formatJoinedTime } from "@/helpers/formatJoinedTime";
import { isActuallyNew } from "@/helpers/isActuallyNew.helper";
import { AccountRequest } from "@/interfaces/request.interfaces";
import Heart from "@/models/hearts.models";
import Product from "@/models/products.models";
import { Request, Response } from "express";
import mongoose from "mongoose";

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

    // Background Non-blocking: Tăng viewsCount bất đồng bộ (Không await)
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
      discount: DiscountPercent(product.price, product.originalPrice),
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
