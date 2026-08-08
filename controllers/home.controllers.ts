import HomeSlide from "@/models/home-slide.models";
import { Request, Response } from "express";

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
      .select("-__v -createdAt -updatedAt -deleted")
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
