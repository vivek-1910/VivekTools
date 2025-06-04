const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileMime = req.file.mimetype;

    // ✅ Handle PDF with pdf-parse (no OCR)
    if (fileMime === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      return res.json({ text: data.text });
    }

    // ✅ Handle images with Tesseract
    const worker = await createWorker({ logger: m => console.log(m) });

    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.:%/()-_, ',
      preserve_interword_spaces: '1',
    });

    const { data: { text } } = await worker.recognize(req.file.buffer);
    await worker.terminate();

    return res.json({ text });
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`OCR Server running on http://localhost:${PORT}`);
  console.log(`New FIle1.14`);
});
