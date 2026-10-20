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

router.get(
  "/products/upload-signature",
  authMiddleWare.verifyToken,
  sellerControllers.getProductUploadSignature,
);

router.patch(
  "/products/:id",
  authMiddleWare.verifyToken,
  sellerControllers.updateSellerProduct,
);

router.post(
  "/create-seller-product",
  authMiddleWare.verifyToken,
  sellerControllers.createSellerProduct,
);

router.delete(
  "/products/:id",
  authMiddleWare.verifyToken,
  sellerControllers.deleteSellerProduct,
);

export default router;
