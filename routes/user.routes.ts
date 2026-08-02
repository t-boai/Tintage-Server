import { Router } from "express";

// Controllers
import * as userControllers from "@/controllers/user.controllers";

const router = Router();

router.post("/register", userControllers.registerPost);

export default router;
