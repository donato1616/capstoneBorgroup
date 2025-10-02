// backend/api/upload.js
import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { originalname, path } = req.file;

    // Create a new study row
    const newStudy = await prisma.studies.create({
      data: {
        id: crypto.randomUUID(),
        code: originalname.split(".")[0], // crude: use filename (minus extension) as study code
        title: `Study from ${originalname}`,
        created_at: new Date(),
        // optional: keep track of the filename
        // source_file column doesn't exist in studies, but you could add it
      },
    });

    res.json({
      message: `Study created successfully from ${originalname}`,
      study: newStudy,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
});

export default router;