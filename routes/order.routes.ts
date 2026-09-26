import { Router } from "express";

// controllers
import * as orderControllers from "@/controllers/order.controllers";

// middle
import * as authMiddleWares from "@/middlewares/auth.middlewares";

const router = Router();

router.post(
  "/place-order/:token",
  authMiddleWares.verifyToken,
  orderControllers.placeOrder,
);

export default router;
