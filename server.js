require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const pdf = require("pdf-parse");
const path = require("path");
const FormData = require("form-data");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ================= DATABASE ================= */

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

pool.connect()
  .then(() => console.log("✅ Database Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    analysis JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => console.log("✅ Reports Table Ready"))
  .catch(err => console.error("DB Table Error:", err.message));

/* ================= FILE UPLOAD ================= */

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  }
});

/* ================= OCR ================= */

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === ".pdf") {
      const buffer = fs.readFileSync(filePath);
      const data = await pdf(buffer);
      return data.text;
    }

    if ([".jpg", ".jpeg", ".png"].includes(ext)) {
      const formData = new FormData();
      formData.append("file", fs.createReadStream(filePath));

      const response = await axios.post(
        "https://api.ocr.space/parse/image",
        formData,
        {
          headers: {
            apikey: process.env.OCR_SPACE_API_KEY,
            ...formData.getHeaders(),
          },
          params: {
            language: "eng",
            isOverlayRequired: false,
          },
          timeout: 30000,
        }
      );

      if (response.data.IsErroredOnProcessing) {
        console.error("❌ OCR Error:", response.data.ErrorMessage);
        return "";
      }

      return response.data?.ParsedResults?.[0]?.ParsedText || "";
    }

    return "";
  } catch (err) {
    console.error("❌ OCR Failed:", err.message);
    return "";
  }
}

/* ================= ANALYZE REPORT ================= */

app.post("/analyze-report", upload.single("newReport"), async (req, res) => {
  let filePath;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Report required" });
    }

    filePath = req.file.path;

    const extractedText = await extractText(filePath);

    console.log("📝 Extracted Text:", extractedText);

    if (!extractedText || extractedText.length < 10) {
      return res.json({
        success: true,
        report: {
          transcription: "Text could not be extracted clearly.",
          simple_summary:
            "The image is unclear or OCR failed. Please upload a clearer image.",
          key_findings: [],
          medications: [],
          recommendations:
            "Ensure the report is fully visible and well-lit.",
          confidence_score: 0,
        },
      });
    }

    const prompt = `
You are a medical AI assistant.

Return ONLY valid JSON:

{
  "transcription": "",
  "simple_summary": "",
  "key_findings": [],
  "medications": [],
  "recommendations": "",
  "confidence_score": ""
}

Report Text:
${extractedText}
`;

    const aiResponse = await axios.post(
      process.env.MISTRAL_API_URL,
      {
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const aiText =
      aiResponse.data?.choices?.[0]?.message?.content || "";

    const match = aiText.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.status(500).json({ error: "AI response format invalid" });
    }

    const parsed = JSON.parse(match[0]);

    await pool.query(
      "INSERT INTO reports (analysis) VALUES ($1)",
      [parsed]
    );

    res.json({ success: true, report: parsed });

  } catch (err) {
    console.error("🔥 Server Error:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.error || "AI processing failed"
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

/* ================= START SERVER ================= */

app.listen(port, () => {
  console.log(`🚀 MediClarify running at http://localhost:${port}`);
});