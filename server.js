require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { createWorker } = require('tesseract.js');
const pdf = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const { fileTypeFromBuffer } = require('file-type');
const { fromPath } = require('pdf2pic');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

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
      cb(new Error('Unsupported file type. Only PDF and images are allowed.'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Function to convert PDF page to image
async function convertPDFPageToImage(pdfBuffer, pageNumber) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const tempPdfPath = path.join(tempDir, 'temp.pdf');
  fs.writeFileSync(tempPdfPath, pdfBuffer);

  const options = {
    density: 300,
    saveFilename: 'page',
    savePath: tempDir,
    format: 'png',
    width: 1200,
    height: 1600
  };

  const convert = fromPath(tempPdfPath, options);
  const { path: imagePath } = await convert(pageNumber, { responseType: 'image' });

  // Optimize image for OCR
  const optimizedImage = await sharp(imagePath)
    .resize(2000) // Resize while maintaining aspect ratio
    .greyscale() // Convert to grayscale
    .normalize() // Enhance contrast
    .toBuffer();

  // Clean up temp files
  fs.rmSync(tempDir, { recursive: true, force: true });

  return optimizedImage;
}

// Function to extract text from PDF
async function extractTextFromPDF(pdfBuffer) {
  try {
    // Try to extract text directly first
    const data = await pdf(pdfBuffer);
    if (data.text.trim().length > 0) {
      return data.text;
    }
    
    // If no text found (scanned PDF), process each page with OCR
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const textPages = [];
    
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
      try {
        const pageImage = await convertPDFPageToImage(pdfBuffer, i + 1);
        const worker = await createWorker();
        
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.:%/()-_, ',
          preserve_interword_spaces: '1',
        });

        const { data: { text } } = await worker.recognize(pageImage);
        await worker.terminate();
        
        textPages.push(text);
      } catch (pageError) {
        console.error(`Error processing page ${i + 1}:`, pageError);
        textPages.push(`[Error processing page ${i + 1}]`);
      }
    }
    
    return textPages.join('\n\n--- PAGE BREAK ---\n\n');
  } catch (error) {
    console.error('PDF Processing Error:', error);
    throw new Error('Failed to process PDF: ' + error.message);
  }
}

// Function to process image with OCR
async function processImageWithOCR(imageBuffer) {
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

    const { data: { text } } = await worker.recognize(imageBuffer);
    return text;
  } finally {
    await worker.terminate();
  }
}

// OCR Processing Endpoint
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Verify file type (in case bypassed multer filter)
const fileType = await fileTypeFromBuffer(req.file.buffer);
    if (!fileType || !(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'].includes(fileType.mime))) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    let result;
    const startTime = Date.now();

    if (fileType.mime === 'application/pdf') {
      result = await extractTextFromPDF(req.file.buffer);
      res.json({ 
        text: result,
        fileType: 'pdf',
        pages: result.split('\n\n--- PAGE BREAK ---\n\n').length,
        processingTime: Date.now() - startTime
      });
    } else {
      result = await processImageWithOCR(req.file.buffer);
      res.json({ 
        text: result,
        fileType: 'image',
        processingTime: Date.now() - startTime
      });
    }
  } catch (error) {
    console.error('Processing Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process file',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    services: {
      pdf: 'active',
      ocr: 'active'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`OCR Server running on http://localhost:${PORT}`);
  console.log('Supported file types: PDF, PNG, JPEG, TIFF');
  console.log(`Test with: curl -X POST -F "file=@path/to/your/file.pdf" http://localhost:${PORT}/api/ocr`);
});
