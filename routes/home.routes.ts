import { Router } from "express";

// controllers
import * as homeControllers from "@/controllers/home.controllers";

const router = Router();

router.get("/slide", homeControllers.slide);
router.get("/categories", homeControllers.categories);
router.get("/products-featured", homeControllers.productsFeatured);
router.get("/daily-discover", homeControllers.dailyDiscover);

export default router;
