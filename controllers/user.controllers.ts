import { Request, Response } from "express";

// Model
import AccountUser from "@/models/account-user.model";

// Bcrypt
import bcrypt from "bcryptjs";

// JWT
import jwt from "jsonwebtoken";

export const registerPost = async (req: Request, res: Response) => {
  const { fullName, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    res.json({
      code: "error",
      message: "Mật khẩu chưa trùng khớp. Vui lòng thử lại <3",
    });
    return;
  }

  const existAccount = await AccountUser.findOne({
    email: email,
  });

  if (existAccount) {
    res.json({
      code: "error",
      message: "Tài khoản đã tồn tại. Vui lòng thử lại <3",
    });
    return;
  }
  // Mã hóa MK với Bcryptjs
  const salt = bcrypt.genSaltSync(10);
  const hashPassword = bcrypt.hashSync(password, salt);

  // Save in DB
  const newAccount = new AccountUser({
    fullName,
    password: hashPassword,
    email,
  });

  await newAccount.save();

  res.json({
    code: "success",
    message: "Đăng kí tài khoản thành công <3",
  });
};

export const loginPost = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const existAccount = await AccountUser.findOne({
      email: email,
    });

    if (!existAccount) {
      res.status(400).json({
        code: "error",
        message:
          "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại <3",
      });
      return;
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      `${existAccount.password}`,
    );

    if (!isPasswordValid) {
      res.status(400).json({
        code: "error",
        message: "Email hoặc mật khẩu không chính xác. Vui lòng thử lại <3",
      });
      return;
    }

    // Create AccessToken
    const accessToken = jwt.sign(
      {
        id: existAccount.id || existAccount._id,
        email: existAccount.email,
      },
      `${process.env.JWT_ACCESS_SECRET}`,
      {
        expiresIn: "15m",
      },
    );

    // Create Refresh Token
    const refreshToken = jwt.sign(
      {
        id: existAccount.id || existAccount._id,
        email: existAccount.email,
      },
      `${process.env.JWT_REFRESH_SECRET}`,
      {
        expiresIn: "7d",
      },
    );

    // Save Refresh in DB
    existAccount.refreshToken = refreshToken;
    await existAccount.save();

    // Save Refresh Token in HTTP-Only
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Save in local
    res.cookie("accessToken", accessToken, {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.status(200).json({
      code: "success",
      message: "Đăng nhập thành công <3",
      accessToken,
    });
  } catch (error) {
    console.log("Lỗi đăng nhập: ", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống Server.",
    });
  }
};
