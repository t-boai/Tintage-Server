import { NextFunction, Request, Response, Router } from "express";

// Route
import userRoutes from "@/routes/user.routes";
import authRoutes from "@/routes/auth.routes";
import homeRoutes from "@/routes/home.routes";
import productRoutes from "@/routes/product.routes";

const router: Router = Router();

router.use((req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.use("/user", userRoutes);
router.use("/auth", authRoutes);
router.use("/home", homeRoutes);
router.use("/product", productRoutes);

export default router;
