import { NextFunction, Request, Response, Router } from "express";
import userRoutes from "@/routes/user.routes";

const router: Router = Router();

router.use((req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.use("/user", userRoutes);

export default router;
