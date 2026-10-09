import { Router } from "express";

// Controllers
import * as userControllers from "@/controllers/user.controllers";

// Middlewares
import * as authMiddlewares from "@/middlewares/auth.middlewares";

const router = Router();

router.post("/register", userControllers.registerPost);
router.post("/login", userControllers.loginPost);
router.get("/profile", authMiddlewares.verifyToken, userControllers.profile);
router.patch(
  "/update-profile",
  authMiddlewares.verifyToken,
  userControllers.updateProfile,
);
router.post(
  "/addAddress",
  authMiddlewares.verifyToken,
  userControllers.addAddress,
);

router.post(
  "/password/request-change-otp",
  authMiddlewares.verifyToken,
  userControllers.requestChangePasswordOtp,
);

router.post(
  "/password/verify-change-otp",
  authMiddlewares.verifyToken,
  userControllers.verifyChangePasswordOtp,
);

router.patch(
  "/password/change",
  authMiddlewares.verifyToken,
  userControllers.executeChangePassword,
);

export default router;
