// backend/routes/field.js
import express from "express";
const router = express.Router();

// Mock data — replace with Prisma queries later
router.get("/dashboard/:userId", async (req, res) => {
  const { userId } = req.params;

  // Eventually, this data will come from the DB
  const data = {
    userId,
    goal: "Complete 20 surveys in Region B",
    progress: { completed: 7, target: 20 },
    nextCheckin: "Friday, 10:00 AM (Zoom)",
  };

  res.json(data);
});

export default router;
