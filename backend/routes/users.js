import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/users/create
router.post("/create", async (req, res) => {
  try {
    const { name, email, role, status } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    const user = await prisma.user_sync.create({
      data: {
        name,
        email,
        raw_json: JSON.stringify({ role, status }),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

export default router;
