import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const count = await prisma.studies.count();
    res.json({ ok: true, message: "Connected to DB", studiesCount: count });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB connection failed" });
  }
});

export default router;
