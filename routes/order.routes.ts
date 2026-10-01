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

router.post(
  "/:orderCode/retry-payment",
  authMiddleWares.verifyToken,
  orderControllers.retryPayment,
);

router.get(
  "/:orderCode/sync-status",
  authMiddleWares.verifyToken,
  orderControllers.syncPaymentStatus,
);

router.get(
  "/my-pending-order",
  authMiddleWares.verifyToken,
  orderControllers.getMyPendingOrder,
);

export default router;
