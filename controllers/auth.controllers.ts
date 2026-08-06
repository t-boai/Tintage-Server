import { Request, Response } from "express";

//Config
import { REFRESH_COOKIE_OPTIONS } from "@/config/refreshCookie-option.config";

// Model
import AccountUser from "@/models/account-user.model";

// JWT
import jwt, { JwtPayload } from "jsonwebtoken";

export const refreshToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Get refresh from cookie
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        code: "error",
        message: "Phiên đăng nhập hết hạn <3",
      });
      return;
    }

    // Decode token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(
        refreshToken,
        `${process.env.JWT_REFRESH_SECRET}`,
      ) as { id: string };
    } catch {
      // Nếu token hết hạn hoặc không hợp lệ -> Xóa
      res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);
      res
        .status(401)
        .json({ code: "error", message: "Token không hợp lệ hoặc đã hết hạn" });
      return;
    }

    // Kiểm tra DB & Phát hiện Reuse Attack
    const user = await AccountUser.findById(decoded.id);
    if (!user) {
      res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);
      res.status(401).json({
        code: "error",
        message: "Tài khoản không tồn tại <3",
      });
      return;
    }

    // Reuse Detection: Nếu token đúng format nhưng không khớp DB -> Token cũ đã bị leak
    if (user.refreshToken !== refreshToken) {
      // Thu hồi toàn bộ session để bảo vệ
      user.refreshToken = "";
      await user.save();

      res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);
      res.status(403).json({
        code: "error",
        message:
          "Cảnh báo bảo mật: Phát hiện truy cập bất thường. Vui lòng đăng nhập lại <3",
      });
      return;
    }

    // Refresh Token Rotation (RTR): Tạo cả Access Token lẫn Refresh Token mới
    const newAccessToken = jwt.sign(
      {
        id: user.id || user._id,
        email: user.email,
      },
      `${process.env.JWT_ACCESS_SECRET}`,
      {
        expiresIn: "15m",
      },
    );

    const newRefreshToken = jwt.sign(
      { id: user.id || user._id },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "7d" },
    );

    // Lưu Refresh Token mới vào DB & Cookie
    user.refreshToken = newRefreshToken;
    await user.save();

    res.cookie("refreshToken", newRefreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      code: "success",
      accessToken: newAccessToken,
    });
  } catch (error) {
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống server",
    });
  }
};

export const logoutPost = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      // Xóa token trong DB
      await AccountUser.findOneAndUpdate(
        { refreshToken },
        { $set: { refreshToken: "" } },
      );
    }

    // Xóa Cookie FE
    res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);

    res.status(200).json({
      code: "success",
      message: "Đăng xuất thành công",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống server" });
  }
};
