import cron from "node-cron";
import Product from "@/models/products.models";

export const initHotScoreCronJob = () => {
  // Chạy vào lúc 2 sáng mỗi ngày
  cron.schedule("0 2 * * *", async () => {
    console.log("CronJob Bắt đầu cập nhật Hot Score cho toàn bộ sản phẩm...");

    try {
      //  tự động quét và update ngầm toàn bộ DB
      const result = await Product.updateMany(
        { deleted: false, isActive: true },
        [
          {
            $set: {
              hotScore: {
                $add: [
                  { $multiply: [{ $ifNull: ["$viewsCount", 0] }, 1] },
                  { $multiply: [{ $ifNull: ["$likesCount", 0] }, 3] },
                  { $multiply: [{ $ifNull: ["$salesCount", 0] }, 5] },
                ],
              },
            },
          },
        ],
        { updatePipeline: true },
      );

      console.log(
        `CronJob Cập nhật thành công Hot Score cho ${result.modifiedCount} sản phẩm!`,
      );
    } catch (error) {
      console.error("CronJob Lỗi khi cập nhật Hot Score:", error);
    }
  });
};
