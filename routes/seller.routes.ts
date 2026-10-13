import { Router } from "express";

// controllers
import * as sellerControllers from "@/controllers/seller.controllers";

// middle
import * as authMiddleWare from "@/middlewares/auth.middlewares";

const router = Router();

router.get(
  "/products",
  authMiddleWare.verifyToken,
  sellerControllers.getSellerProducts,
);

router.patch(
  "/products/:id",
  authMiddleWare.verifyToken,
  sellerControllers.updateSellerProduct,
);

export default router;
