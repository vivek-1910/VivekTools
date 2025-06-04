require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const FileType = require('file-type');

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileType = await FileType.fromBuffer(req.file.buffer);
    if (!fileType) {
      return res.status(400).json({ error: 'Unsupported or undetectable file type' });
    }

    const mime = fileType.mime;

    if (mime === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      return res.json({ text: data.text });
    }

    if (mime.startsWith('image/')) {
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
    }

    return res.status(400).json({ error: `Unsupported file type: ${mime}` });

  } catch (error) {
    console.error('OCR Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`OCR Server running on http://localhost:${PORT}`);
  console.log(`New FIle1.22`);
});
