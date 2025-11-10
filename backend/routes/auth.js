// backend/routes/auth.js
import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

router.post("/login", async (req, res) => {
  const { role, name, password } = req.body;

  if (!role || !name || !password)
    return res.status(400).json({ error: "Missing fields" });

  try {
    let user = null;

    if (role === "admin") {
      user = await prisma.admins.findFirst({ where: { name } });
    } else if (role === "analyst") {
      user = await prisma.analysts.findFirst({ where: { name } });
    } else if (role === "field") {
      user = await prisma.interviewers.findFirst({ where: { code: name } });
    } else {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (!user) return res.status(401).json({ error: "Invalid name" });

    const rolePw = await prisma.rolePasswords.findFirst({ where: { role } });
    if (!rolePw) return res.status(500).json({ error: "Role password not set" });

    if (password !== rolePw.password)
      return res.status(401).json({ error: "Incorrect password" });

    const token = `${role}-${user.id}-token`;

    res.json({
      success: true,
      user: { id: user.id, name, role },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;