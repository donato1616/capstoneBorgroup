import express from "express";
import prisma from "../lib/prisma.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json({ message: "Announcements route working" });
});

router.post("/create", async (req, res) => {
  try {
    const { title, announcement, role, post_till } = req.body;

    if (!title || !announcement || !role || !post_till)
      return res.status(400).json({ error: "Missing fields" });

    const record = await prisma.announcements.create({
      data: {
        title,
        announcement,
        role,
        post_till: new Date(post_till)
      },
    });

    res.json(record);
  } catch (err) {
    console.error("Announcement create error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// Add this route to backend/routes/announcements.js
router.get("/field", async (req, res) => {
  try {
    const announcements = await prisma.announcements.findMany({
      where: {
        role: "field", // Only get announcements for field researchers
        post_till: {
          gt: new Date() // Only get announcements that haven't expired
        }
      },
      orderBy: {
        date_posted: 'desc' // Most recent first
      }
    });

    res.json(announcements);
  } catch (err) {
    console.error("Error fetching field announcements:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/analyst", async (req, res) => {
  try {
    const announcements = await prisma.announcements.findMany({
      where: {
        role: "analyst", // Only get announcements for field researchers
        post_till: {
          gt: new Date() // Only get announcements that haven't expired
        }
      },
      orderBy: {
        date_posted: 'desc' // Most recent first
      }
    });

    res.json(announcements);
  } catch (err) {
    console.error("Error fetching field announcements:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
