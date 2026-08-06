import { Request, Response } from "express";

// Model
import AccountUser from "@/models/account-user.model";

// Bcrypt
import bcrypt from "bcryptjs";

// JWT
import jwt from "jsonwebtoken";

// Interface
import { AccountRequest } from "@/interfaces/request.interfaces";
import { REFRESH_COOKIE_OPTIONS } from "@/config/refreshCookie-option.config";

export const registerPost = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fullName, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      res.status(400).json({
        code: "error",
        message: "Mật khẩu chưa trùng khớp. Vui lòng thử lại <3",
      });
      return;
    }

    const existAccount = await AccountUser.findOne({ email });
    if (existAccount) {
      res.status(400).json({
        code: "error",
        message: "Tài khoản đã tồn tại. Vui lòng thử lại <3",
      });
      return;
    }

    // Mã hóa MK với Bcryptjs
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);

    // Random avt
    const randomAvt = `${process.env.API_AVT}${email}`;

    // Save in DB
    const newAccount = new AccountUser({
      fullName,
      password: hashPassword,
      email,
      avatar: randomAvt,
    });

    await newAccount.save();

    res.status(201).json({
      code: "success",
      message: "Đăng kí tài khoản thành công <3",
    });
  } catch (error) {
    console.log("Lỗi đăng kí: ", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống server. Vui lòng thử lại sau <3",
    });
  }
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
    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

    const userResponse = {
      id: existAccount._id,
      fullName: existAccount.fullName,
      email: existAccount.email,
      avatar: existAccount.avatar,
    };

    res.status(200).json({
      code: "success",
      message: "Đăng nhập thành công <3",
      accessToken,
      user: userResponse,
    });
  } catch (error) {
    console.log("Lỗi đăng nhập: ", error);
    res.status(500).json({
      code: "error",
      message: "Lỗi hệ thống Server.",
    });
  }
};

export const profile = async (req: AccountRequest, res: Response) => {
  res.status(200).json({
    code: "success",
    message: "Lấy thông tin thành công <3",
    data: req.account,
  });
};
