import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    phone: String,
    avatar: String,
    refreshToken: { type: String, default: "" },
  },
  {
    timestamps: true,
  },
);

const AccountUser = mongoose.model("AccountUser", schema, "user");

export default AccountUser;
