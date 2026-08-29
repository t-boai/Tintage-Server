import { Response, NextFunction } from "express";
import { AccountRequest } from "@/interfaces/request.interfaces";
import jwt from "jsonwebtoken";

export const optionalAuthMiddleware = async (
  req: AccountRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    if (!token) return next();

    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET as string,
    ) as jwt.JwtPayload;

    if (decoded && decoded.id) {
      req.account = { id: decoded.id } as any;
    }
    next();
  } catch (error) {
    // Bỏ qua lỗi token -> coi như Guest
    next();
  }
};
