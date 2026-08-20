import { Router } from "express";

// controller
import * as heartControllers from "@/controllers/heart.controllers";

// middlewares
import * as authMiddlewares from "@/middlewares/auth.middlewares";

const router = Router();

router.post(
  "/add/:id",
  authMiddlewares.verifyToken,
  heartControllers.heartPost,
);

router.get("/my-heart", authMiddlewares.verifyToken, heartControllers.myHeart);

router.get(
  "/my-heartlist",
  authMiddlewares.verifyToken,
  heartControllers.myHeartList,
);
export default router;
