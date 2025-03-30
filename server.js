require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { createWorker } = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 8000;  // Change 7000 to 8000

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for in-memory file handling (no disk storage)
const upload = multer({ storage: multer.memoryStorage() });

// OCR Processing Endpoint
app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const worker = await createWorker({
      logger: m => console.log(m),
    });

    try {
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.:%/()-_, ',
        preserve_interword_spaces: '1',
      });

      // Process image from memory buffer
      const { data: { text } } = await worker.recognize(req.file.buffer);
      
      await worker.terminate();
      return res.json({ text });
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OCR Server running on http://localhost:${PORT}`);
  console.log(`Test with: curl -X POST -F "image=@path/to/your/image.jpg" http://localhost:${PORT}/api/ocr`);
});
