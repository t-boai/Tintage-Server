import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";

import { deleteCloudinaryImage } from "@/helpers/cloudinary.helper";

const redisConnection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const fileCleanupQueue = new Queue("file-cleanup-queue", {
  connection: redisConnection,
});

const fileCleanupWorker = new Worker(
  "file-cleanup-queue",
  async (job: Job) => {
    const { publicId } = job.data;
    console.log(`Worker - FileCleanup Đang tiến hành xóa ảnh rác: ${publicId}`);

    const isSuccess = await deleteCloudinaryImage(publicId);

    if (!isSuccess) {
      // Exponential Backoff
      throw new Error(`Xóa ảnh thất bại trên Cloudinary: ${publicId}`);
    }

    return true;
  },
  {
    connection: redisConnection,
    concurrency: 5, // Xử lý song song tối đa 5 file cùng lúc
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
