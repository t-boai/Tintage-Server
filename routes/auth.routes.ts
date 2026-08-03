import { Router } from "express";

// Controllers
import * as authControllers from "@/controllers/auth.controllers";

const router = Router();

router.get("refresh-token", authControllers.refreshToken);

export default router;
