import mongoose from "mongoose";

export const connect = async () => {
  try {
    await mongoose.connect(`${process.env.DATABASE}`);

    console.log("Connect DB Success");
  } catch (error) {
    console.log("Connect DB Error: ", error);
  }
};
