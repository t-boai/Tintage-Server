import { Request, Response } from "express";

// modal
import Slide from "@/models/slide.models";
import Categories from "@/models/categories.models";
import Product from "@/models/products.models";

//moment
import moment from "moment";

// helpers
import { isActuallyNew } from "@/helpers/isActuallyNew.helper";
import Blog from "@/models/blogs.models";

export const slide = async (req: Request, res: Response): Promise<void> => {
  try {
    const currentDate = new Date();
    const slides = await Slide.find({
      deleted: false,
      isActive: true,
      $and: [
        // Kiểm tra Slide đã đến ngày hiển thị chưa
        {
          $or: [{ startDate: null }, { startDate: { $lte: currentDate } }],
        },
        // Kiểm tra Slide đã hết hạn chưa
        {
          $or: [{ endDate: null }, { endDate: { $gte: currentDate } }],
        },
      ],
    })
      .sort({
        order: 1,
        createdAt: -1,
      }) // Ưu tiên sắp xếp theo order
      .lean();

    const slidesFinal = slides.map((item) => ({
      id: item._id.toString(),
      badge: item.badge,
      titleLine1: item.titleLine1,
      titleLine2: item.titleLine2,
      description: item.description,
      primaryBtn: item.primaryBtn,
      secondaryBtn: item.secondaryBtn,
      image: item.image,
      alt: item.alt,
    }));

    res.setHeader("Cache-Control", "public, max-age=300");

    res.status(200).json({
      code: "success",
      message: "Lấy thông tin slide thành công <3",
      data: slidesFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy slide:", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống server. Vui lòng thử lại sau.",
    });
  }
};

export const categories = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const categories = await Categories.find({
      deleted: false,
      isActive: true,
      isFeatured: true,
    })
      .sort({ order: 1, createdAt: -1 })
      .lean();

    // Format
    const categoryFinal = categories.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      image: item.image,
      href: `/categories/${item.slug}`,
    }));

    res.setHeader("Cache-Control", "public, max-age=300");

    res.status(200).json({
      code: "success",
      message: "Lấy danh sách danh mục nổi bật thành công <3",
      data: categoryFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy danh mục nổi bật:", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống server. Vui lòng thử lại sau.",
    });
  }
};

export const productsFeatured = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const limit = 6;

    // Aggregation tính điểm Hot Score động
    const products = await Product.aggregate([
      {
        $match: {
          deleted: false,
          isActive: true,
          stock: { $gt: 0 },
        },
      },
      {
        $addFields: {
          // Công thức: views*1 + likes*3 + sales*5
          hotScore: {
            $add: [
              { $multiply: [{ $ifNull: ["$viewsCount", 0] }, 1] },
              { $multiply: [{ $ifNull: ["$likesCount", 0] }, 3] },
              { $multiply: [{ $ifNull: ["$salesCount", 0] }, 5] },
            ],
          },
        },
      },
      {
        $sort: {
          isFeatured: -1, // true lên trước
          order: 1, // order nhỏ lên trước
          hotScore: -1, // Điểm Hot cao lên trước
          createdAt: -1, // Mới nhất lên trước
        },
      },
      { $limit: limit },
      // Join (Lookup) sang collection categories để lấy tên & slug danh mục
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
      //
      {
        $lookup: {
          from: "users",
          let: { sellerId: "$seller" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$sellerId"] },
                    { $eq: ["$deleted", false] },
                    { $eq: ["$isActive", true] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                fullName: 1,
                avatar: 1,
                isVerifiedSeller: 1,
                sellerRole: 1,
                sellerRating: 1,
              },
            },
          ],
          as: "sellerInfo",
        },
      },
      {
        $unwind: {
          path: "$sellerInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    const productsFinal = products.map((item) => {
      const actuallyNew = isActuallyNew(item.isNewProduct, item.createdAt);

      return {
        id: item._id.toString(),
        brand: item.brand,
        name: item.name,
        price: item.price,
        condition: item.condition ? `Độ mới ${item.condition}%` : null,
        size: item.size || null,
        isNew: actuallyNew,
        image: item.images[0] || "",
        originalPrice: item.originalPrice,
        location: item.location,
        slug: item.slug,
        salesCount: item.salesCount,
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
              fullName: item.sellerInfo.fullName,
              avatar: item.sellerInfo.avatar || "",
              isVerifiedSeller: item.sellerInfo.isVerifiedSeller || false,
              sellerRole: item.sellerInfo.sellerRole || "individual",
              sellerRating: item.sellerInfo.sellerRating || 5.0,
            }
          : null,
      };
    });

    res.setHeader("Cache-Control", "public, max-age=900");

    res.status(200).json({
      code: "success",
      message: "Lấy sản phẩm nổi bật thành công <3",
      data: productsFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy sản phẩm mới nổi bật: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const dailyDiscover = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const limit = 12;
    // Đóng băng cache tới 12h tối
    const now = new Date();
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    // tính số giây từ hiện tại cho đến 23:59:59 đêm nay
    const second = Math.floor((endOfDay.getTime() - now.getTime()) / 1000);

    // Random product có logic
    const products = await Product.aggregate([
      // Lọc hàng còn tồn kho và đang active
      {
        $match: {
          deleted: false,
          stock: { $gt: 0 },
          isActive: true,
        },
      },
      // Tối ưu Index - chỉ quét 200 sản phẩm mới nhất
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      // Tính điểm HotScore
      {
        $addFields: {
          hotScore: {
            $add: [
              { $multiply: [{ $ifNull: ["$viewsCount", 0] }, 1] },
              { $multiply: [{ $ifNull: ["$likesCount", 0] }, 3] },
              { $multiply: [{ $ifNull: ["$salesCount", 0] }, 5] },
            ],
          },
        },
      },
      // Giữ lại 50 sản phẩm xuất sắc nhất
      { $sort: { hotScore: -1 } },
      { $limit: 50 },
      // Lấy random 12 sp trong 50 sp
      { $sample: { size: limit } },
      // Join (Lookup) sang categories để lấy tên & slug
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
          let: { sellerId: "$seller" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$sellerId"] },
                    { $eq: ["$deleted", false] },
                    { $eq: ["$isActive", true] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                fullName: 1,
                avatar: 1,
                isVerifiedSeller: 1,
                sellerRole: 1,
                sellerRating: 1,
              },
            },
          ],
          as: "sellerInfo",
        },
      },
      {
        $unwind: {
          path: "$sellerInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    // Format
    const productsFinal = products.map((item) => {
      const actuallyNew = isActuallyNew(item.isNewProduct, item.createdAt);

      return {
        id: item._id.toString(),
        brand: item.brand,
        name: item.name,
        price: item.price,
        condition: item.condition ? `Độ mới ${item.condition}%` : null,
        size: item.size || null,
        isNew: actuallyNew,
        image: item.images[0] || "",
        originalPrice: item.originalPrice,
        location: item.location,
        slug: item.slug,
        salesCount: item.salesCount,
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
              fullName: item.sellerInfo.fullName,
              avatar: item.sellerInfo.avatar || "",
              isVerifiedSeller: item.sellerInfo.isVerifiedSeller || false,
              sellerRole: item.sellerInfo.sellerRole || "individual",
              sellerRating: item.sellerInfo.sellerRating || 5.0,
            }
          : null,
      };
    });

    // Lưu Cache đến 12h tối
    res.setHeader("Cache-Control", `public, max-age=${second}`);
    res.status(200).json({
      code: "success",
      message: "Lấy Gợi ý hôm nay thành công <3",
      data: productsFinal,
    });
  } catch (error) {
    console.error("Lỗi lấy sản phẩm gợi ý hôm nay: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const blogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = 3;
    const blogs = await Blog.find({
      deleted: false,
      isActive: true,
      publishedAt: { $lte: new Date() },
    })
      .sort({
        publishedAt: -1,
        createdAt: -1,
      })
      .limit(limit)
      .select(
        "category title description image slug readTime publishedAt createdAt",
      )
      .lean();

    const blogsFinal = blogs.map((item) => ({
      id: item._id.toString(),
      category: item.category,
      title: item.title,
      description: item.description,
      date: moment(item.publishedAt || item.createdAt).format("DD/MM/YYYY"),
      readTime: `${item.readTime || 5} phút đọc`,
      image: item.image,
      slug: item.slug,
    }));

    res.setHeader(
      "Cache-Control",
      "public, max-age=1800, stale-while-revalidate=60",
    );

    res.status(200).json({
      code: "success",
      message: "Lấy danh sách bài viết mới nhất thành công <3",
      data: blogsFinal,
    });
  } catch (error) {
    console.error("Lấy danh sách Blog lỗi: ", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống server. Vui lòng thử lại sau.",
    });
  }
};
