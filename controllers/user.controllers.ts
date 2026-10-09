import { Request, Response } from "express";

// Model
import AccountUser from "@/models/account-user.model";

// Bcrypt
import bcrypt from "bcryptjs";

// JWT
import jwt from "jsonwebtoken";

// validates
import { addAddressSchema } from "@/validates/addAddressSchema.validate";

// mongoose
import mongoose from "mongoose";

// configs
import { REFRESH_COOKIE_OPTIONS } from "@/config/refreshCookie-option.config";

// Interface
import { AccountRequest } from "@/interfaces/request.interfaces";

// z
import z from "zod";
import { redisClient } from "@/config/redis.config";
import { getOtpEmailHtml, sendMail } from "@/helpers/mail.helper";
import { generateRandomNumber } from "@/helpers/generate.helper";
import { randomUUID } from "node:crypto";

const updateProfileSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Họ tên quá ngắn.")
      .max(100, "Họ tên không được vượt quá 100 ký tự.")
      .optional(),
    avatar: z
      .string()
      .trim()
      .url("Đường dẫn ảnh đại diện không hợp lệ.")
      .optional()
      .or(z.literal("")),
  })
  .strict();

const requestChangeOtpSchema = z.object({
  currentPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại."),
});

const verifyChangeOtpSchema = z.object({
  otp: z.string().length(6, "Mã OTP phải bao gồm 6 chữ số."),
});

const changePasswordSchema = z
  .object({
    actionToken: z.string().min(1, "Thiếu Action Token."),
    newPassword: z.string().min(6, "Mật khẩu mới phải từ 6 ký tự."),
    confirmPassword: z.string().min(1, "Vui lòng xác nhận mật khẩu mới."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp.",
    path: ["confirmPassword"],
  });

export const registerPost = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fullName, email, password, confirmPassword } = req.body;

    if (!password || password !== confirmPassword) {
      res.status(400).json({
        code: "error",
        message: "Mật khẩu chưa trùng khớp. Vui lòng thử lại <3",
      });
      return;
    }

    const cleanEmail = email?.trim().toLowerCase();
    const cleanFullName = fullName?.trim();

    const existAccount = await AccountUser.findOne({
      email: cleanEmail,
      deleted: false,
    }).lean();

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
      fullName: cleanFullName,
      password: hashPassword,
      email: cleanEmail,
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

export const loginPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const existAccount = await AccountUser.findOne({
      email: email,
      deleted: false,
    }).select("+password");

    if (!existAccount) {
      res.status(400).json({
        code: "error",
        message:
          "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại <3",
      });
      return;
    }

    if (!existAccount.isActive) {
      res.status(403).json({
        code: "error",
        message: "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ CSKH <3",
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
    await AccountUser.updateOne(
      {
        _id: existAccount._id,
      },
      {
        $set: { refreshToken: refreshToken },
      },
    );

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

export const profile = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const cacheKey = `user:profile:${userId}`;
    const cachedProfile = await redisClient.get(cacheKey);

    if (cachedProfile) {
      res.status(200).json({
        code: "success",
        message: "Lấy thông tin thành công <3",
        data: JSON.parse(cachedProfile),
      });
      return;
    }

    const user = await AccountUser.findOne({
      _id: userId,
      deleted: false,
    })
      .select("-password -refreshToken -deleted")
      .lean();

    if (!user) {
      res.status(404).json({
        code: "error",
        message: "Không tìm thấy tài khoản.",
      });
      return;
    }

    const formattedAddresses = (user.address || []).map((addr: any) => ({
      ...addr,
      id: addr._id.toString(),
    }));

    const { _id, address, ...restUser } = user as any;
    const profileData = {
      id: _id.toString(),
      ...restUser,
      address: formattedAddresses,
    };

    await redisClient
      .set(cacheKey, JSON.stringify(profileData), { EX: 600 })
      .catch(console.error);

    res.status(200).json({
      code: "success",
      message: "Lấy thông tin thành công <3",
      data: profileData,
    });
  } catch (error) {
    console.error("[Get Profile Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

export const updateProfile = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
      });
      return;
    }

    const updateData = parseResult.data;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        code: "error",
        message: "Không có dữ liệu nào được thay đổi.",
      });
      return;
    }

    const updatedUser = await AccountUser.findOneAndUpdate(
      { _id: userId, deleted: false },
      { $set: updateData },
      { new: true, runValidators: true },
    )
      .select("-password -refreshToken -deleted")
      .lean();

    if (!updatedUser) {
      res
        .status(404)
        .json({ code: "error", message: "Không tìm thấy tài khoản." });
      return;
    }

    // Cache-Aside Pattern
    const cacheKey = `user:profile:${userId}`;
    await redisClient.del(cacheKey).catch(console.error);

    const formattedAddresses = (updatedUser.address || []).map((addr: any) => ({
      ...addr,
      id: addr._id.toString(),
    }));

    const { _id, address, ...restUser } = updatedUser as any;

    res.status(200).json({
      code: "success",
      message: "Cập nhật hồ sơ thành công!",
      data: { id: _id.toString(), ...restUser, address: formattedAddresses },
    });
  } catch (error) {
    console.error("[Update Profile Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

const MAX_address = 5;

export const addAddress = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = addAddressSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "error",
        message:
          parseResult.error.issues[0]?.message || "Dữ liệu không hợp lệ.",
      });
      return;
    }

    const { isDefault, province, district, ward, street, ...restAddressData } =
      parseResult.data;

    const fullAddress = `${street}, ${ward}, ${district}, ${province}`;
    const newAddressId = new mongoose.Types.ObjectId();
    const newAddress = {
      _id: newAddressId,
      ...restAddressData,
      province,
      district,
      ward,
      street,
      fullAddress,
      isDefault,
    };

    if (isDefault) {
      const updatedUser = await AccountUser.findOneAndUpdate(
        {
          _id: userId,
          $expr: {
            $lt: [{ $size: { $ifNull: ["$address", []] } }, MAX_address],
          },
        },
        [
          {
            $set: {
              address: {
                $concatArrays: [
                  {
                    $map: {
                      input: { $ifNull: ["$address", []] },
                      as: "addr",
                      in: { $mergeObjects: ["$$addr", { isDefault: false }] },
                    },
                  },
                  [{ ...newAddress, isDefault: true }],
                ],
              },
            },
          },
        ],
        { new: false, updatePipeline: true },
      );

      if (!updatedUser) {
        return handleFailedUpdate(userId, res);
      }
    } else {
      const pushResult = await AccountUser.findOneAndUpdate(
        {
          _id: userId,
          "address.0": { $exists: true },
          $expr: { $lt: [{ $size: "$address" }, MAX_address] },
        },
        {
          $push: { address: { ...newAddress, isDefault: false } },
        },
        { new: false },
      );

      if (!pushResult) {
        const firstInsert = await AccountUser.findOneAndUpdate(
          {
            _id: userId,
            $or: [{ address: { $size: 0 } }, { address: { $exists: false } }],
          },
          {
            $push: { address: { ...newAddress, isDefault: true } },
          },
          { new: false },
        );

        if (!firstInsert) {
          return handleFailedUpdate(userId, res);
        }

        newAddress.isDefault = true;
      }
    }

    // Xóa cache profile trên Redis để đồng bộ địa chỉ mới nhất
    await redisClient.del(`user:profile:${userId}`).catch(console.error);

    const { _id, ...restDataFE } = newAddress;
    const responseData = {
      id: _id.toString(),
      ...restDataFE,
    };

    res.status(201).json({
      code: "success",
      message: "Thêm địa chỉ thành công.",
      data: responseData,
    });
  } catch (error: any) {
    console.error("Lỗi khi thêm địa chỉ: ", error.message || error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống." });
  }
};

async function handleFailedUpdate(
  userId: string,
  res: Response,
): Promise<void> {
  const user = await AccountUser.findById(userId).select("address").lean();
  if (!user) {
    res
      .status(404)
      .json({ code: "error", message: "Không tìm thấy tài khoản." });
    return;
  }
  if ((user.address?.length || 0) >= MAX_address) {
    res.status(400).json({
      code: "error",
      message: `Bạn chỉ được tạo tối đa ${MAX_address} địa chỉ. Vui lòng xóa bớt địa chỉ cũ.`,
    });
    return;
  }
  res.status(409).json({
    code: "error",
    message: "Thao tác bị gián đoạn, vui lòng thử lại.",
  });
}

export const requestChangePasswordOtp = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = requestChangeOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      res
        .status(400)
        .json({ code: "error", message: parseResult.error.issues[0]?.message });
      return;
    }
    const { currentPassword } = parseResult.data;

    const user = await AccountUser.findById(userId)
      .select("+password isEmailVerified email")
      .lean();
    if (!user) {
      res
        .status(404)
        .json({ code: "error", message: "Tài khoản không tồn tại." });
      return;
    }

    if (!user.isEmailVerified) {
      res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Email chưa được xác thực. Vui lòng xác thực email trước khi đổi mật khẩu.",
      });
      return;
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      `${user.password}`,
    );
    if (!isPasswordValid) {
      res
        .status(400)
        .json({ code: "error", message: "Mật khẩu hiện tại không chính xác." });
      return;
    }

    const cooldownKey = `cooldown:change_pwd:${userId}`;
    const acquiredCooldown = await redisClient.set(cooldownKey, "LOCKED", {
      NX: true,
      EX: 60,
    });

    if (!acquiredCooldown) {
      res.status(429).json({
        code: "error",
        message: "Vui lòng đợi 60 giây trước khi yêu cầu lại mã OTP.",
      });
      return;
    }

    const otp = generateRandomNumber(6);
    const otpKey = `change_pwd:otp:${userId}`;
    const attemptsKey = `change_pwd:attempts:${userId}`;

    // Reset OTP và xóa số lần nhập sai
    await Promise.all([
      redisClient.set(otpKey, otp, { EX: 300 }),
      redisClient.del(attemptsKey), // Xóa attempts cũ
    ]);

    const subject = `Mã OTP Đổi mật khẩu - Tintage`;
    const htmlContent = getOtpEmailHtml(
      otp,
      "Chúng tôi nhận được yêu cầu đổi mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã xác thực dưới đây để tiếp tục:",
    );

    sendMail(user.email, subject, htmlContent).catch((err) =>
      console.error("[Email Sending Failed]:", err),
    );

    res.status(200).json({
      code: "success",
      message: `Mã OTP đã được gửi đến email ${user.email}`,
    });
  } catch (error) {
    console.error("[Request Change Pwd OTP Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

export const verifyChangePasswordOtp = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = verifyChangeOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      res
        .status(400)
        .json({ code: "error", message: parseResult.error.issues[0]?.message });
      return;
    }
    const { otp } = parseResult.data;

    const otpKey = `change_pwd:otp:${userId}`;
    const attemptsKey = `change_pwd:attempts:${userId}`;

    //  chống brute-force bằng atomic (incr trước mới check)
    const attempts = await redisClient.incr(attemptsKey);
    // Nếu là lần sai đầu tiên, set TTL cho attemptsKey bằng với OTP (300s)
    if (attempts === 1) {
      await redisClient.expire(attemptsKey, 300);
    }

    if (attempts > 5) {
      await redisClient.del(otpKey);
      await redisClient.del(attemptsKey);
      res.status(429).json({
        code: "error",
        message:
          "Bạn đã nhập sai quá 5 lần. OTP đã bị hủy, vui lòng xin lại mã mới.",
      });
      return;
    }

    const storedOtp = await redisClient.get(otpKey);
    if (!storedOtp) {
      res.status(400).json({
        code: "error",
        message: "Mã OTP đã hết hạn hoặc không tồn tại.",
      });
      return;
    }

    if (storedOtp !== otp) {
      res.status(400).json({
        code: "error",
        message: `Mã OTP không chính xác. Bạn còn ${5 - attempts} lần thử.`,
      });
      return;
    }

    // ĐÚNG OTP -> Xóa
    await Promise.all([redisClient.del(otpKey), redisClient.del(attemptsKey)]);

    //  cấp action token
    const jti = randomUUID();
    const actionToken = jwt.sign(
      { id: userId, purpose: "CHANGE_PASSWORD_CONFIRMED", jti },
      `${process.env.JWT_ACCESS_SECRET}`,
      { expiresIn: "10m" },
    );

    // Lưu jti vào Redis để token Chỉ dùng 1 lần
    await redisClient.set(`valid_action_token:${jti}`, "VALID", { EX: 600 });

    res.status(200).json({
      code: "success",
      message: "Xác thực OTP thành công.",
      data: { actionToken },
    });
  } catch (error) {
    console.error("[Verify Change Pwd OTP Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};

export const executeChangePassword = async (
  req: AccountRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.account?.id;
    if (!userId) {
      res.status(401).json({ code: "error", message: "Vui lòng đăng nhập." });
      return;
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      res
        .status(400)
        .json({ code: "error", message: parseResult.error.issues[0]?.message });
      return;
    }
    const { actionToken, newPassword } = parseResult.data;

    let decoded: any;
    try {
      decoded = jwt.verify(actionToken, `${process.env.JWT_ACCESS_SECRET}`);
      if (
        decoded.purpose !== "CHANGE_PASSWORD_CONFIRMED" ||
        decoded.id !== userId
      ) {
        throw new Error("Invalid Token Context");
      }
    } catch (err) {
      res.status(403).json({
        code: "error",
        message: "Phiên đổi mật khẩu không hợp lệ hoặc đã hết hạn.",
      });
      return;
    }

    // Lấy user và kiểm tra mật khẩu cũ
    const user = await AccountUser.findById(userId).select("+password").lean();
    if (!user) {
      res
        .status(404)
        .json({ code: "error", message: "Tài khoản không tồn tại." });
      return;
    }

    const isSamePassword = await bcrypt.compare(
      newPassword,
      `${user.password}`,
    );
    if (isSamePassword) {
      res.status(400).json({
        code: "error",
        message: "Mật khẩu mới không được trùng với mật khẩu hiện tại.",
      });
      return;
    }

    // đã qua hết validate -> burn token (atomic)
    const jtiKey = `valid_action_token:${decoded.jti}`;
    const isTokenValidAndBurned = await redisClient.del(jtiKey);

    if (!isTokenValidAndBurned) {
      res.status(403).json({
        code: "error",
        message: "Phiên đổi mật khẩu đã được sử dụng.",
      });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await AccountUser.updateOne(
      { _id: userId },
      {
        $set: {
          password: hashedPassword,
          refreshToken: "",
        },
      },
    );

    res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);
    await redisClient.del(`user:profile:${userId}`).catch(console.error);

    res.status(200).json({
      code: "success",
      message:
        "Đổi mật khẩu thành công. Vui lòng đăng nhập lại với mật khẩu mới.",
    });
  } catch (error) {
    console.error("[Execute Change Pwd Error]:", error);
    res.status(500).json({ code: "error", message: "Lỗi hệ thống Server." });
  }
};
