import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

console.log("[field.js] interviewers routes loaded");

// 🧠 Get all interviewers (for FieldMgmt.jsx)
router.get("/all", async (req, res) => {
  try {
    const interviewers = await prisma.interviewers.findMany({
      include: {
        responses: {
          select: { is_complete: true },
        },
      },
    });

    // Compute number of completed interviews
    const formatted = interviewers.map((i) => ({
      id: i.id,
      name: i.full_name || i.code, // fallback if full_name is null
      completedCount: i.responses.filter((r) => r.is_complete).length,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching interviewers:", err);
    res.status(500).json({ error: "Failed to fetch interviewers" });
  }
});

// ✏️ Edit interviewer info (placeholder for now)
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, code } = req.body;

    const updated = await prisma.interviewers.update({
      where: { id },
      data: { code },
    });

    res.json(updated);
  } catch (err) {
    console.error("Error updating interviewer:", err);
    res.status(500).json({ error: "Failed to update interviewer" });
  }
});

// ⚙️ Suspend / Activate toggle (stub)
router.put("/toggle-status/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // since interviewers have no status column, we just return OK for now
    res.json({ ok: true, message: "Suspend/Activate is not implemented yet" });
  } catch (err) {
    console.error("Error toggling status:", err);
    res.status(500).json({ error: "Failed to toggle status" });
  }
});

// 📊 Dashboard-like endpoint for individual interviewer
router.get("/dashboard/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const interviewer = await prisma.interviewers.findUnique({
      where: { id },
      include: {
        responses: {
          select: { is_complete: true, duration_sec: true },
        },
      },
    });

    if (!interviewer) return res.status(404).json({ error: "Interviewer not found" });

    const refreshed = await prisma.interviewers.findUnique({
  where: { id },
  include: {
    responses: { select: { is_complete: true } },
  },
});

res.json({
  id: refreshed.id,
  name: (refreshed.code || "").toUpperCase(),
  completedCount: refreshed.responses.filter((r) => r.is_complete).length,
});

  } catch (err) {
    console.error("Error fetching interviewer dashboard:", err);
    res.status(500).json({ error: "Failed to fetch interviewer dashboard" });
  }
});

// ➕ Add new interviewer
router.post("/add", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: "Code (name) is required" });
    }

    const newInterviewer = await prisma.interviewers.create({
      data: { code: code.trim().toUpperCase() },
    });

    res.json(newInterviewer);
  } catch (err) {
    console.error("Error creating interviewer:", err);
    res.status(500).json({ error: "Failed to add interviewer" });
  }
});

export default router;
