require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createWorker } = require('tesseract.js');
const { fromBuffer } = require('pdf2pic');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const worker = await createWorker({
      logger: m => console.log(m),
    });

    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.:%/()-_, ',
      preserve_interword_spaces: '1',
    });

    let buffer = req.file.buffer;

    if (req.file.mimetype === 'application/pdf') {
      const convert = fromBuffer(buffer, {
        density: 150,
        format: 'png',
        width: 1200,
        height: 1600,
      });

      const page1 = await convert(1); // convert only first page
      buffer = page1.base64 ? Buffer.from(page1.base64, 'base64') : buffer;
    }

    const { data: { text } } = await worker.recognize(buffer);

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
  console.log(`Test with image: curl -X POST -F "image=@yourfile.jpg" http://localhost:${PORT}/api/ocr`);
  console.log(`Test with PDF: curl -X POST -F "image=@yourfile.pdf" http://localhost:${PORT}/api/ocr`);
});
