import { Response } from "express";

//interface
import { AccountRequest } from "@/interfaces/request.interfaces";

// model
import Heart from "@/models/hearts.models";
import Product from "@/models/products.models";

// mongoose
import mongoose from "mongoose";

export const heartPost = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id: productId } = req.params;
    const { isLiked } = req.body;
    const userId = req.account?._id || req.account?.id;

    if (!mongoose.Types.ObjectId.isValid(`${productId}`)) {
      res
        .status(400)
        .json({ code: "error", message: "ID Sản phẩm không hợp lệ" });
      return;
    }

    let updatedLikesCount = 0;
    //  user thả tim (isLiked = true)
    if (isLiked) {
      //  Dùng upsert để chống Spam Click
      //  tìm { user, product }. Nếu chưa có thì tạo mới (upsert: true).
      // Nếu đã có rồi thì bỏ qua không làm gì cả.
      const heartResult = await Heart.updateOne(
        { user: userId, product: productId },
        { $setOnInsert: { user: userId, product: productId } },
        { upsert: true },
      );

      // upsertedCount > 0 nghĩa là vừa có 1 record Heart mới được tạo ra
      // Khi đó mới cộng 1 vào likesCount của Product
      if (heartResult.upsertedCount > 0) {
        const product = await Product.findByIdAndUpdate(
          productId,
          { $inc: { likesCount: 1 } },
          { new: true },
        ).select("likesCount");

        updatedLikesCount = product?.likesCount || 0;
      } else {
        // Nếu user spam click và db đã có tim rồi, chỉ trả về số tim hiện tại
        const product = await Product.findById(productId)
          .select("likesCount")
          .lean();
        updatedLikesCount = product?.likesCount || 0;
      }
    }
    // user bỏ tim (isLiked = false)
    else {
      // Xóa record Heart
      const deleteResult = await Heart.deleteOne({
        user: userId,
        product: productId,
      });

      // deletedCount > 0 nghĩa là đã xóa thành công 1 record
      // khi đó ta mới trừ 1 vào likesCount của Product (và đảm bảo likesCount > 0 để không bị âm)
      if (deleteResult.deletedCount > 0) {
        const product = await Product.findOneAndUpdate(
          { _id: productId, likesCount: { $gt: 0 } }, // Chống số âm
          { $inc: { likesCount: -1 } },
          { new: true },
        ).select("likesCount");

        updatedLikesCount = product?.likesCount || 0;
      } else {
        // Nếu user spam click bỏ tim, chỉ lấy số hiện tại
        const product = await Product.findById(productId)
          .select("likesCount")
          .lean();
        updatedLikesCount = product?.likesCount || 0;
      }
    }

    res.status(200).json({
      code: "success",
      message: isLiked
        ? "Đã yêu thích sản phẩm <3"
        : "Đã bỏ yêu thích sản phẩm",
      likesCount: updatedLikesCount,
    });
  } catch (error) {
    console.error("[Toggle Heart Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const myHeart = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account._id || req.account.id;

    // Tìm tất cả các record thả tim của User này
    // Dùng .select("product") để chỉ lấy đúng trường product (chứa ID sản phẩm)

    const hearts = await Heart.find({
      user: userId,
    })
      .select("product -_id")
      .lean();

    const heartData = hearts.map((h) => h.product);

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.status(200).json({
      code: "success",
      message: "Lấy danh sách ID sản phẩm đã tim thành công <3",
      data: heartData,
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách sản phẩm đã tim: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};

export const myHeartList = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?._id || req.account?.id;

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 10),
    );
    const skip = (page - 1) * limit;

    const userObjectId = new mongoose.Types.ObjectId(userId.toString());

    const result = await Heart.aggregate([
      // lọc tất cả tim của User hiện tại (Đánh đúng Index { user: 1 })
      {
        $match: {
          user: userObjectId,
        },
      },
      //  Sắp xếp sản phẩm mới thả tim lên đầu
      {
        $sort: {
          createdAt: -1,
        },
      },
      // Join (Lookup) sang collection products để lấy thông tin sản phẩm
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      //  Giải nén mảng productInfo thành Object
      {
        $unwind: {
          path: "$productInfo",
          preserveNullAndEmptyArrays: false, // Loại bỏ ngay nếu sản phẩm không tồn tại
        },
      },
      // Chỉ lấy sản phẩm còn hoạt động & chưa bị xóa
      {
        $match: {
          "productInfo.deleted": false,
          "productInfo.isActive": true,
        },
      },
      // Dùng $facet để tính Tổng số lượng (total) và Lấy danh sách phân trang (data) trong 1 QUERY duy nhất
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            // Join tiếp sang collection categories để lấy thông tin danh mục
            {
              $lookup: {
                from: "categories",
                localField: "productInfo.category",
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
            // Chỉ chiếu (Project) đúng các trường cần dùng
            {
              $project: {
                _id: 0,
                heartId: "$_id",
                likedAt: "$createdAt",
                product: {
                  id: "$productInfo._id",
                  brand: "$productInfo.brand",
                  name: "$productInfo.name",
                  price: "$productInfo.price",
                  originalPrice: "$productInfo.originalPrice",
                  condition: {
                    $cond: {
                      if: "$productInfo.condition",
                      then: {
                        $concat: [
                          "Độ mới ",
                          { $toString: "$productInfo.condition" },
                          "%",
                        ],
                      },
                      else: null,
                    },
                  },
                  size: "$productInfo.size",
                  image: { $arrayElemAt: ["$productInfo.images", 0] }, // Lấy ảnh đầu tiên
                  slug: "$productInfo.slug",
                  stock: "$productInfo.stock",
                  location: "$productInfo.location",
                  category: {
                    $cond: {
                      if: "$categoryInfo",
                      then: {
                        id: "$categoryInfo._id",
                        name: "$categoryInfo.name",
                        slug: "$categoryInfo.slug",
                      },
                      else: null,
                    },
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    // Xử lý kết quả trả về từ $facet
    const totalItems = result[0]?.metadata[0]?.total || 0;
    const heartlistData = result[0]?.data || [];
    const totalPages = Math.ceil(totalItems / limit);

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.status(200).json({
      code: "success",
      message: "Lấy danh sách sản phẩm yêu thích thành công <3",
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
      },
      data: heartlistData,
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách sản phẩm đã tim: ", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server." });
  }
};
