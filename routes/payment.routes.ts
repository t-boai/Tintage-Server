import { Router } from "express";

// controllers
import * as paymentControllers from "@/controllers/payment.controllers";

const router = Router();

router.post("/momo/ipn", paymentControllers.handleMomoIPN);

export default router;
