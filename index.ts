// Setup Env
import dotenv from "dotenv";
dotenv.config();

import express from "express";

const app = express();
const port = 4000;

// CORS
import cors from "cors";
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, //Cho phép gửi cookie
  }),
);

// Connect DB
import { connect } from "@/config/database.config";
connect();

// khởi tạo cronjob chạy ngầm sau khi connect DB
import { initHotScoreCronJob } from "@/jobs/updateHotScore.job";
initHotScoreCronJob();

// Allow send data JSON
app.use(express.json());

import cookieParser from "cookie-parser";
app.use(cookieParser());

// Setup Routes
import routes from "@/routes/index";
app.use("/", routes);

app.listen(port, () => {
  console.log("Running at port: ", port);
});
