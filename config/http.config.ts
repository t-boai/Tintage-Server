import axios from "axios";
import http from "http";
import https from "https";

export const ghtkAxiosClient = axios.create({
  baseURL: process.env.GHTK_API_URL || "https://services.giaohangtietkiem.vn",
  timeout: 3000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 200 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 200 }),
});
