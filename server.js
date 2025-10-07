require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const { createWorker } = require('tesseract.js');
const pdf = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const { fileTypeFromBuffer } = require('file-type');
const { fromPath } = require('pdf2pic');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const monitoring = require('./ocrMonitoring');

const app = express();
const PORT = process.env.PORT || 8000;

// Performance optimizations
app.use(compression()); // Enable gzip compression
app.use(cors());
app.use(express.json());
app.disable('x-powered-by'); // Remove Express header

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${method} ${url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

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
  const startTime = Date.now();
  let fileType = 'unknown';
  let pages = 0;
  
  try {
    if (!req.file) {
      monitoring.recordRequest({ 
        fileType: 'none', 
        processingTime: Date.now() - startTime, 
        error: 'No file provided', 
        success: false 
      });
      return res.status(400).json({ error: 'No file provided' });
    }

    // Verify file type (in case bypassed multer filter)
    const detectedFileType = await fileTypeFromBuffer(req.file.buffer);
    if (!detectedFileType || !(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'].includes(detectedFileType.mime))) {
      monitoring.recordRequest({ 
        fileType: detectedFileType?.mime || 'unknown', 
        processingTime: Date.now() - startTime, 
        error: 'Unsupported file type', 
        success: false 
      });
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    let result;

    if (detectedFileType.mime === 'application/pdf') {
      fileType = 'pdf';
      result = await extractTextFromPDF(req.file.buffer);
      pages = result.split('\n\n--- PAGE BREAK ---\n\n').length;
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        pages, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'pdf',
        pages,
        processingTime
      });
    } else {
      fileType = 'image';
      result = await processImageWithOCR(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'image',
        processingTime
      });
    }
  } catch (error) {
    console.error('Processing Error:', error);
    
    const processingTime = Date.now() - startTime;
    monitoring.recordRequest({ 
      fileType, 
      processingTime, 
      error: error.message, 
      pages, 
      success: false 
    });
    
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
    },
    timestamp: Date.now()
  });
});

// Comprehensive status endpoint
app.get('/api/status', (req, res) => {
  try {
    const status = monitoring.getStatus();
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      server: 'OCR/PDF Processing Server',
      ...status,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: Date.now(),
    });
  }
});

// Simple health check
app.get('/api/health', (req, res) => {
  const health = monitoring.getHealth();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'critical' ? 503 : 200;
  res.status(statusCode).json(health);
});

// Self-ping mechanism to keep server alive on Render
function startSelfPing() {
  const PING_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const pingUrl = process.env.RENDER_EXTERNAL_URL || 'https://vivektools.onrender.com';
  
  async function selfPing() {
    try {
      const response = await fetch(`${pingUrl}/health`);
      if (response.ok) {
        console.log(`[Self-Ping] Success - ${new Date().toISOString()}`);
      } else {
        console.warn(`[Self-Ping] Failed - Status: ${response.status}`);
      }
    } catch (error) {
      console.warn(`[Self-Ping] Error:`, error.message);
    }
  }
  
  // Start pinging after 30 seconds, then every 5 minutes
  setTimeout(() => {
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
    console.log(`[Self-Ping] Started - Interval: 5 minutes, URL: ${pingUrl}`);
  }, 30000);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 OCR Server running on http://localhost:${PORT}`);
  console.log('📄 Supported file types: PDF, PNG, JPEG, TIFF');
  console.log('⚡ Compression: Enabled');
  console.log('📊 Monitoring: Active');
  console.log(`💉 Test with: curl -X POST -F "file=@path/to/your/file.pdf" http://localhost:${PORT}/api/ocr`);
  
  // Start self-ping in production
  if (process.env.RENDER_EXTERNAL_URL || process.env.NODE_ENV === 'production') {
    startSelfPing();
  }
});
