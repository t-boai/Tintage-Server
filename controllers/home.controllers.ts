import { Request, Response } from "express";

// modal
import Slide from "@/models/slide.models";
import Categories from "@/models/categories.models";
import Product from "@/models/products.models";

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

    // 2. Tạo slideResponse chọn lọc đúng các trường FE cần và đổi _id -> id
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

    // HIGH TRAFFIC TACTIC: HTTP Caching
    // Báo cho Trình duyệt/CDN tự động cache API này trong 5 phút
    // Giảm 90% tải cho Server nếu f5 liên tục
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
    ]);

    const productsFinal = products.map((item) => ({
      id: item._id.toString(),
      brand: item.brand,
      name: item.name,
      price: item.price,
      condition: item.condition ? `Độ mới ${item.condition}%` : null,
      size: item.size || null,
      isNew: item.isNewProduct,
      image: item.images[0] || "",
      slug: item.slug,
      category: item.categoryInfo
        ? {
            id: item.categoryInfo._id.toString(),
            name: item.categoryInfo.name,
            slug: item.categoryInfo.slug,
          }
        : null,
    }));

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
