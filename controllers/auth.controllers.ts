import AccountUser from "@/models/account-user.model";
import { Request, Response } from "express";

// JWT
import jwt from "jsonwebtoken";

export const refreshToken = async (req: Request, res: Response) => {
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
    const decoded = jwt.verify(
      refreshToken,
      `${process.env.JWT_REFRESH_SECRET}`,
    ) as { id: string };

    // Check token match DB?
    const user = await AccountUser.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      res.status(403).json({
        code: "error",
        message: "Token không hợp lệ <3",
      });
      return;
    }

    // Create new access
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

    res.status(200).json({
      code: "success",
      accessToken: newAccessToken,
    });
  } catch (error) {
    res.status(401).json({
      code: "error",
      message: "Refresh token hết hạn",
    });
  }
};
