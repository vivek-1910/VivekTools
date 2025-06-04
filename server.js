require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { createWorker } = require('tesseract.js');
const { pdf } = require('pdf-to-text');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for in-memory file handling
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  }
});

// Function to extract text from PDF
async function extractTextFromPDF(pdfBuffer) {
  try {
    // Try to extract text directly first
    const text = await pdf(pdfBuffer);
    if (text.trim().length > 0) {
      return text;
    }
    
    // If no text found (might be scanned PDF), convert to images
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const textPages = [];
    
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      
      // For each page, we could render it as an image and use Tesseract
      // This is a placeholder - you'd need to implement actual rendering
      // For now, we'll just return a message about scanned PDFs
      textPages.push(`[Scanned PDF Page ${i+1} - requires OCR processing]`);
    }
    
    return textPages.join('\n\n--- PAGE BREAK ---\n\n');
  } catch (error) {
    console.error('PDF Processing Error:', error);
    throw new Error('Failed to process PDF');
  }
}

// OCR Processing Endpoint
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Handle PDF files
    if (req.file.mimetype === 'application/pdf') {
      const text = await extractTextFromPDF(req.file.buffer);
      return res.json({ 
        text,
        fileType: 'pdf',
        pages: text.split('\n\n--- PAGE BREAK ---\n\n').length
      });
    }

    // Handle image files (original OCR functionality)
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

      const { data: { text } } = await worker.recognize(req.file.buffer);
      
      await worker.terminate();
      return res.json({ 
        text,
        fileType: 'image'
      });
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  } catch (error) {
    console.error('Processing Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process file' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OCR Server running on http://localhost:${PORT}`);
  console.log(`new 1.25`);
  console.log(`Test with: curl -X POST -F "file=@path/to/your/file.pdf" http://localhost:${PORT}/api/ocr`);
});
