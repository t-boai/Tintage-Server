import { Router } from "express";

// controller
import * as productControllers from "@/controllers/product.controllers";

// middlewares
import * as authMiddlewares from "@/middlewares/auth.middlewares";

const router = Router();

router.post(
  "/:id/heart",
  authMiddlewares.verifyToken,
  productControllers.heartPost,
);

router.get(
  "/my-heart",
  authMiddlewares.verifyToken,
  productControllers.myHeart,
);

router.get(
  "/my-heartlist",
  authMiddlewares.verifyToken,
  productControllers.myHeartList,
);
export default router;
