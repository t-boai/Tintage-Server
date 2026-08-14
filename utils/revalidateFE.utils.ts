import axios from "axios";

export const triggerRevalidateFE = async (tag: string): Promise<void> => {
  try {
    // URL API của Frontend (Next.js) - Lấy từ file .env
    const FE_URL = process.env.FRONTEND_URL;
    const SECRET = process.env.REVALIDATE_SECRET || "";

    // Bắn request kèm Header Secret sang cho FE - Không dùng await chặn luồng chính để API BE trả về cho Admin nhanh nhất
    axios
      .post(
        `${FE_URL}/api/revalidate?tag=${tag}`,
        {},
        {
          headers: {
            "x-revalidate-secret": SECRET,
          },
          timeout: 500,
        },
      )
      .then(() => {
        console.log(`Revalidate Success: Đã xóa cache tag "${tag}" trên FE.`);
      })
      .catch((err) => {
        // Chỉ log lỗi, không làm sập API bên BE
        console.error(
          `Revalidate Failed: Không thể xóa cache tag "${tag}". Lỗi: ${err.message}`,
        );
      });
  } catch (error) {
    console.error("Revalidate System Error:", error);
  }
};
