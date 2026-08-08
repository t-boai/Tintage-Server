import { Router } from "express";

// controllers
import * as homeControllers from "@/controllers/home.controllers";

const router = Router();

router.get("/slide", homeControllers.slide);
router.get("/categories", homeControllers.categories);

export default router;
