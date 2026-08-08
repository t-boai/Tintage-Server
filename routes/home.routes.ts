import { Router } from "express";

// controllers
import * as homeControllers from "@/controllers/home.controllers";

const router = Router();

router.get("/slide", homeControllers.slide);

export default router;
