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
  const userId = req.account?.id;

  const userAddress = await AccountUser.findById(userId)
    .select("address")
    .lean();

  const formattedAddresses = (userAddress?.address || []).map((addr: any) => ({
    ...addr,
    id: addr._id.toString(),
  }));

  res.status(200).json({
    code: "success",
    message: "Lấy thông tin thành công <3",
    data: {
      ...req.account,
      address: formattedAddresses,
    },
  });
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

    // Validate
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

    res.status(201).json({
      code: "success",
      message: "Thêm địa chỉ thành công.",
      data: newAddress,
    });
  } catch (error: any) {
    console.error("Lỗi khi thêm địa chỉ: ", error.message || error);
    console.error("Lỗi khi thêm địa chỉ:", error);
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
