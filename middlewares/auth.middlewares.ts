import { Response, NextFunction } from "express";

// interface
import { AccountRequest } from "@/interfaces/request.interfaces";

// JWT
import jwt from "jsonwebtoken";

// Modal
import AccountUser from "@/models/account-user.model";

export const verifyToken = async (
  req: AccountRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Get access token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        code: "error",
        message: "Không tìm thấy Access Token hợp lệ <3",
      });
      return;
    }

    const token = authHeader.split(" ")[1];

    // Decode
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET as string,
    ) as jwt.JwtPayload;

    const { id, email } = decoded;
    let account = null;

    const existAccount = await AccountUser.findById(id)
      .select("-password -refreshToken -createdAt -updatedAt -__v")
      .lean();

    account = existAccount;

    if (!account || account.email !== email) {
      res.status(401).json({
        code: "error",
        message: "Tài khoản không tồn tại hoặc đã bị thay đổi <3",
      });
      return;
    }

    req.account = account;
    next();
  } catch (error) {
    // Phân loại lỗi
    const isExpired = error instanceof jwt.TokenExpiredError;

    // Bắt buộc trả 401 để  FE Auto-Refresh
    res.status(401).json({
      code: isExpired ? "token_expired" : "invalid_token",
      message: isExpired ? "Access Token đã hết hạn!" : "Token không hợp lệ!",
    });
  }
};
