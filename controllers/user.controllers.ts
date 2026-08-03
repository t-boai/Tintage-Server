import { Request, Response } from "express";

// Model
import AccountUser from "@/models/account-user.model";

// Bcrypt
import bcrypt from "bcryptjs";

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
