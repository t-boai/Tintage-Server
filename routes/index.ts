import { NextFunction, Request, Response, Router } from "express";

// Route
import userRoutes from "@/routes/user.routes";
import authRoutes from "@/routes/auth.routes";

const router: Router = Router();

router.use((req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.use("/user", userRoutes);
router.use("/auth", authRoutes);

export default router;
