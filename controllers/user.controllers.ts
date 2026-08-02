import { Request, Response } from "express";

export const registerPost = async (req: Request, res: Response) => {
  res.json({
    message: "Ok Server",
  });
};
