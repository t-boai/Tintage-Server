import { Router } from "express";

// controllers
import * as productControllers from "@/controllers/product.controllers";
import { optionalAuthMiddleware } from "@/middlewares/optional-auth.middleware";

const router = Router();

router.get(
  "/detail/:slugOrId",
  optionalAuthMiddleware,
  productControllers.productDetail,
);

router.get("/recommendations", productControllers.recommendations);
router.get(
  "/search",
  optionalAuthMiddleware,
  productControllers.searchProducts,
);

export default router;
