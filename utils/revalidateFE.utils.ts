const revalidateTimeouts: Record<string, NodeJS.Timeout> = {};

export const triggerFrontendRevalidate = (
  tag: string,
  delay: number = 30000,
) => {
  // Nếu đang có 1 luồng đếm ngược rồi thì BỎ QUA, không set lại nữa
  if (revalidateTimeouts[tag]) {
    return; // Kệ cho nó chạy hết delay rồi nó tự clear
  }

  // Bắt đầu đếm ngược 'delay' (30 giây)
  revalidateTimeouts[tag] = setTimeout(() => {
    const feUrl = process.env.NEXT_PUBLIC_FE_URL;
    const secret = process.env.REVALIDATE_SECRET_TOKEN;

    if (!feUrl || !secret) {
      console.warn(
        "[Revalidate] Thiếu biến môi trường FE_URL hoặc SECRET_TOKEN",
      );
      return;
    }

    const url = `${feUrl}/api/revalidate`;

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ tag }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.text();
          console.error(`[Revalidate Error] Tag: ${tag} -`, err);
        } else {
          console.log(`[Revalidate Success] Tag: ${tag} cleared on Frontend.`);
        }
      })
      .catch((error) => {
        console.error(
          `[Revalidate Failed] Network Error for tag ${tag}:`,
          error.message,
        );
      })
      .finally(() => {
        // Chạy xong thì xóa cờ, lúc này các request tiếp theo mới được phép tạo timeout mới
        delete revalidateTimeouts[tag];
      });
  }, delay);
};
