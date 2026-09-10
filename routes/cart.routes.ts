import { Router } from "express";

// controllers
import * as cartControllers from "@/controllers/cart.controllers";

// middlewares
import * as middleWares from "@/middlewares/auth.middlewares";

const router = Router();

router.get("/my-cart", middleWares.verifyToken, cartControllers.myCart);
router.post("/add/:id", middleWares.verifyToken, cartControllers.addToCartPost);
router.patch(
  "/update-quantity/:productId",
  middleWares.verifyToken,
  cartControllers.updateQuantityPatch,
);

router.delete(
  "/delete/:productId",
  middleWares.verifyToken,
  cartControllers.deleteItem,
);

router.post(
  "/delete-multiple",
  middleWares.verifyToken,
  cartControllers.deleteMultipleItems,
);

router.delete(
  "/clear-cart",
  middleWares.verifyToken,
  cartControllers.clearCart,
);

router.delete(
  "/clear-unavailable",
  middleWares.verifyToken,
  cartControllers.clearUnavailable,
);

export default router;
