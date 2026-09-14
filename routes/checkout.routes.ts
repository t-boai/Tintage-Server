import { Router } from "express";

// controllers
import * as checkoutControllers from "@/controllers/checkout.controllers";

// middle
import * as middleWares from "@/middlewares/auth.middlewares";

const router = Router();

router.post(
  "/init",
  middleWares.verifyToken,
  checkoutControllers.initCheckoutSession,
);

// router.get(
//   "/session/:token",
//   middleWares.verifyToken,
//   checkoutControllers.getCheckoutSession,
// );

export default router;
