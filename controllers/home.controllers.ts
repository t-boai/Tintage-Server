import { Request, Response } from "express";

// modal
import HomeSlide from "@/models/home-slide.models";
import HomeCategories from "@/models/home-categories.models";

export const slide = async (req: Request, res: Response): Promise<void> => {
  try {
    const currentDate = new Date();
    const slides = await HomeSlide.find({
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
    const categories = await HomeCategories.find({
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
