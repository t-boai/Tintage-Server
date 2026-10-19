import { Queue, Worker, Job } from "bullmq";
import { deleteCloudinaryImage } from "@/helpers/cloudinary.helper";
import { redisClient } from "@/config/redis.config"; // 👉 TỐI ƯU: Dùng chung file config

export const fileCleanupQueue = new Queue("file-cleanup-queue", {
  connection: redisClient, // 👉 TỐI ƯU: Dùng chung Connection
});

const fileCleanupWorker = new Worker(
  "file-cleanup-queue",
  async (job: Job) => {
    const { publicId } = job.data;
    console.log(`Worker - FileCleanup Đang tiến hành xóa ảnh rác: ${publicId}`);

    const isSuccess = await deleteCloudinaryImage(publicId);

    if (!isSuccess) {
      // Exponential Backoff sẽ tự động kích hoạt nhờ BullMQ
      throw new Error(`Xóa ảnh thất bại trên Cloudinary: ${publicId}`);
    }

    return true;
  },
  {
    connection: redisClient,
    concurrency: 5,

    // 🛡️ VŨ KHÍ TỐI THƯỢNG BẢO VỆ QUOTA REDIS FREE:
    drainDelay: 60000, // Ngủ 60 giây nếu queue trống
    skipStalledCheck: true, // Tắt check kẹt job ngầm (30s/lần)
  },
);

fileCleanupWorker.on("completed", (job) => {
  console.log(
    `Worker - FileCleanup Job ${job.id} xóa thành công: ${job.returnvalue}`,
  );
});

fileCleanupWorker.on("failed", (job, err) => {
  console.error(
    `Worker - FileCleanup Job ${job?.id} thất bại (Sẽ tự Retry):`,
    err.message,
  );
});
