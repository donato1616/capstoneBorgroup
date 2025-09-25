import express from "express";
import cors from "cors";

import uploadRoute from "./api/upload.js";
import pingRoute from "./api/ping.js";

const app = express();

// middlewares first
app.use(cors());
app.use(express.json());

// then routes
app.use("/api/upload", uploadRoute);
app.use("/api/ping", pingRoute);

const PORT = 30002;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));