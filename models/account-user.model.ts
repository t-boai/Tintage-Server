import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    fullName: String,
    email: String,
    password: String,
    phone: String,
    avatar: String,
  },
  {
    timestamps: true,
  },
);

const AccountUser = mongoose.model("AccountUser", schema, "user");

export default AccountUser;
