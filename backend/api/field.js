import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

console.log("[field.js] field routes loaded");


// 🧠 Get all researchers (for admin FieldMgmt.jsx)
router.get("/all", async (req, res) => {
  try {
    const researchers = await prisma.fieldResearcher.findMany({
      orderBy: { id: "desc" },
    });
    res.json(researchers);
  } catch (err) {
    console.error("Error fetching researchers:", err);
    res.status(500).json({ error: "Failed to fetch researchers" });
  }
});


// 🧩 Create new researcher
router.post("/create", async (req, res) => {
  try {
    const { name, email, role, assignedProjects, status } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    // Avoid duplicates
    const exists = await prisma.fieldResearcher.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ error: "A researcher with this email already exists." });
    }

    const newResearcher = await prisma.fieldResearcher.create({
      data: {
        name,
        email,
        role: role || "FR",
        assignedGoals: `${assignedProjects || 0} assigned project(s)`,
        progressDone: 0,
        progressTarget: assignedProjects || 0,
        nextCheckin: null,
      },
    });

    res.json(newResearcher);
  } catch (err) {
    console.error("Error creating researcher:", err);
    res.status(500).json({ error: "Failed to create researcher" });
  }
});


// ✏️ Update researcher info
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, assignedProjects, status } = req.body;

    const updated = await prisma.fieldResearcher.update({
      where: { id: Number(id) },
      data: {
        name,
        role,
        assignedGoals: `${assignedProjects} assigned project(s)`,
        progressTarget: assignedProjects,
        nextCheckin: null,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Error updating researcher:", err);
    res.status(500).json({ error: "Failed to update researcher" });
  }
});


// ⚙️ Suspend / Activate toggle
router.put("/toggle-status/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.fieldResearcher.findUnique({
      where: { id: Number(id) },
    });

    if (!user) return res.status(404).json({ error: "Researcher not found" });

    const newStatus =
      user.assignedGoals === "Suspended" ? "Active" : "Suspended";

    const updated = await prisma.fieldResearcher.update({
      where: { id: Number(id) },
      data: { assignedGoals: newStatus },
    });

    res.json(updated);
  } catch (err) {
    console.error("Error toggling status:", err);
    res.status(500).json({ error: "Failed to toggle researcher status" });
  }
});


// 📊 Dashboard (field researcher POV)
router.get("/dashboard/:userId", async (req, res) => {
  const { userId } = req.params;
  const finalUserId = userId || 1; // fallback to 1 if not provided

  try {
    let { userId } = req.params;

    if (!userId || userId === "undefined") {
      const firstUser = await prisma.fieldResearcher.findFirst();
      if (!firstUser)
        return res.status(404).json({ error: "No researchers found in database" });
      userId = firstUser.id;
    }

    const user = await prisma.fieldResearcher.findUnique({
      where: { id: Number(userId) },
    });

    if (!user) return res.status(404).json({ error: "Researcher not found" });

    res.json({
      userId: user.id,
      name: user.name,
      goal: user.assignedGoals || "No goal assigned.",
      progress: {
        completed: user.progressDone,
        target: user.progressTarget,
      },
      nextCheckin: user.nextCheckin || "No schedule yet.",
    });
  } catch (err) {
    console.error("Error fetching dashboard:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


export default router;