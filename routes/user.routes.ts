import { Router } from "express";

// Controllers
import * as userControllers from "@/controllers/user.controllers";

// Middlewares
import * as authMiddlewares from "@/middlewares/auth.middlewares";

const router = Router();

router.post("/register", userControllers.registerPost);
router.post("/login", userControllers.loginPost);
router.get("/profile", authMiddlewares.verifyToken, userControllers.profile);
router.post(
  "/addAddress",
  authMiddlewares.verifyToken,
  userControllers.addAddress,
);

export default router;
