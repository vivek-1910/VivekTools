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
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const xlsx = require('xlsx');

// Performance: Reusable Tesseract worker pool
let tesseractWorkerPool = [];
const WORKER_POOL_SIZE = 4; // Increased for better parallelism
let workerPoolInitialized = false;

async function initWorkerPool() {
  if (workerPoolInitialized) return;
  console.log('[OCR] Initializing Tesseract worker pool...');
  
  for (let i = 0; i < WORKER_POOL_SIZE; i++) {
    const worker = await createWorker({
      logger: () => {}, // Disable logging for speed
      errorHandler: (err) => console.error('[OCR Worker Error]', err)
    });
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: '1', // Auto page segmentation
      preserve_interword_spaces: '1',
    });
    tesseractWorkerPool.push({ worker, busy: false });
  }
  
  workerPoolInitialized = true;
  console.log(`[OCR] Worker pool initialized with ${WORKER_POOL_SIZE} workers`);
}

async function getAvailableWorker() {
  await initWorkerPool();
  
  // Find available worker
  let availableWorker = tesseractWorkerPool.find(w => !w.busy);
  
  // If all busy, wait for one to become available
  while (!availableWorker) {
    await new Promise(resolve => setTimeout(resolve, 100));
    availableWorker = tesseractWorkerPool.find(w => !w.busy);
  }
  
  availableWorker.busy = true;
  return availableWorker;
}

function releaseWorker(workerObj) {
  workerObj.busy = false;
}

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
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
      'application/msword', // DOC
      'application/vnd.ms-powerpoint', // PPT
      'application/vnd.ms-excel', // XLS
      'text/plain', // TXT
      'text/csv', // CSV
      'application/rtf', // RTF
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Supported: PDF, DOCX, PPTX, XLSX, DOC, PPT, XLS, TXT, CSV, RTF, and images.'), false);
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit (increased for larger documents)
  }
});

// Function to convert PDF page to image (optimized)
async function convertPDFPageToImage(pdfBuffer, pageNumber) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const tempPdfPath = path.join(tempDir, 'temp.pdf');
  fs.writeFileSync(tempPdfPath, pdfBuffer);

  const options = {
    density: 200, // Reduced from 300 - faster, still accurate
    saveFilename: 'page',
    savePath: tempDir,
    format: 'png',
    width: 1200,
    height: 1600
  };

  const convert = fromPath(tempPdfPath, options);
  const { path: imagePath } = await convert(pageNumber, { responseType: 'image' });

  // Optimize image for OCR - faster processing
  const optimizedImage = await sharp(imagePath)
    .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }) // Smaller = faster
    .greyscale()
    .normalize()
    .toBuffer();

  // Clean up temp files
  fs.rmSync(tempDir, { recursive: true, force: true });

  return optimizedImage;
}

// Function to extract text from DOCX (optimized)
async function extractTextFromDOCX(buffer) {
  try {
    // Use convertToHtml which is faster than extractRawText for large docs
    const result = await mammoth.extractRawText({ 
      buffer,
      // Skip image processing for speed
      convertImage: mammoth.images.imgElement(() => ({ src: '' }))
    });
    return result.value;
  } catch (error) {
    console.error('DOCX Processing Error:', error);
    throw new Error('Failed to process DOCX: ' + error.message);
  }
}

// Function to extract text from PPTX
async function extractTextFromPPTX(buffer) {
  try {
    // Write buffer to temp file for officeparser
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-'));
    const tempPath = path.join(tempDir, 'temp.pptx');
    fs.writeFileSync(tempPath, buffer);
    
    const text = await officeParser.parseOfficeAsync(tempPath);
    
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return text || '';
  } catch (error) {
    console.error('PPTX Processing Error:', error);
    throw new Error('Failed to process PPTX: ' + error.message);
  }
}

// Function to extract text from XLSX/XLS (optimized)
async function extractTextFromExcel(buffer) {
  try {
    // Fast parsing - skip formulas and formatting
    const workbook = xlsx.read(buffer, { 
      type: 'buffer',
      cellFormula: false,
      cellStyles: false,
      sheetStubs: false
    });
    let allText = [];
    
    // Limit to first 10 sheets for speed
    const sheetsToProcess = workbook.SheetNames.slice(0, 10);
    
    sheetsToProcess.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const csvText = xlsx.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
      allText.push(`\n--- Sheet: ${sheetName} ---\n${csvText}`);
    });
    
    return allText.join('\n\n');
  } catch (error) {
    console.error('Excel Processing Error:', error);
    throw new Error('Failed to process Excel file: ' + error.message);
  }
}

// Function to extract text from DOC (legacy Word)
async function extractTextFromDOC(buffer) {
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-'));
    const tempPath = path.join(tempDir, 'temp.doc');
    fs.writeFileSync(tempPath, buffer);
    
    const text = await officeParser.parseOfficeAsync(tempPath);
    
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return text || '';
  } catch (error) {
    console.error('DOC Processing Error:', error);
    throw new Error('Failed to process DOC: ' + error.message);
  }
}

// Function to extract text from PPT (legacy PowerPoint)
async function extractTextFromPPT(buffer) {
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-'));
    const tempPath = path.join(tempDir, 'temp.ppt');
    fs.writeFileSync(tempPath, buffer);
    
    const text = await officeParser.parseOfficeAsync(tempPath);
    
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return text || '';
  } catch (error) {
    console.error('PPT Processing Error:', error);
    throw new Error('Failed to process PPT: ' + error.message);
  }
}

// Function to extract text from plain text files
async function extractTextFromPlainText(buffer) {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    console.error('Text Processing Error:', error);
    throw new Error('Failed to process text file: ' + error.message);
  }
}

// Function to extract text from PDF (ultra-optimized)
async function extractTextFromPDF(pdfBuffer) {
  try {
    // Fast text extraction - most PDFs have text layer
    const data = await pdf(pdfBuffer, { max: 0 });
    
    // If we got decent text, return immediately (90% of PDFs)
    if (data.text.trim().length > 50) {
      return data.text;
    }
    
    // Scanned PDF - use OCR but be smart about it
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    
    // Limit pages for speed (most users only need first few pages)
    const pageCount = Math.min(totalPages, 10); // Reduced from 30 to 10
    const textPages = [];
    
    console.log(`[PDF OCR] Processing ${pageCount} of ${totalPages} pages in parallel...`);
    
    // Process ALL pages in parallel (not batched) - maximum speed
    const promises = [];
    for (let i = 0; i < pageCount; i++) {
      promises.push(
        (async () => {
          try {
            const pageImage = await convertPDFPageToImage(pdfBuffer, i + 1);
            const workerObj = await getAvailableWorker();
            
            try {
              const { data: { text } } = await workerObj.worker.recognize(pageImage);
              return { index: i, text };
            } finally {
              releaseWorker(workerObj);
            }
          } catch (pageError) {
            console.error(`Error processing page ${i + 1}:`, pageError);
            return { index: i, text: `[Error on page ${i + 1}]` };
          }
        })()
      );
    }
    
    // Wait for all pages to complete
    const results = await Promise.all(promises);
    results.sort((a, b) => a.index - b.index);
    textPages.push(...results.map(r => r.text));
    
    if (pageCount < totalPages) {
      textPages.push(`\n[Processed ${pageCount}/${totalPages} pages for speed. Upload fewer pages for full extraction.]`);
    }
    
    return textPages.join('\n\n--- PAGE BREAK ---\n\n');
  } catch (error) {
    console.error('PDF Processing Error:', error);
    throw new Error('Failed to process PDF: ' + error.message);
  }
}

// Function to process image with OCR (optimized with worker pool)
async function processImageWithOCR(imageBuffer) {
  const workerObj = await getAvailableWorker();
  
  try {
    // Optimize image before OCR for speed
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();
    
    const { data: { text } } = await workerObj.worker.recognize(optimizedBuffer);
    return text;
  } finally {
    releaseWorker(workerObj);
  }
}

// OCR Processing Endpoint (optimized for speed)
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

    // Fast file type detection - trust client MIME type
    const mimeType = req.file.mimetype;
    let detectedFileType = null;
    
    // Only do deep detection if mimetype is missing or generic
    if (!mimeType || mimeType === 'application/octet-stream') {
      detectedFileType = await fileTypeFromBuffer(req.file.buffer);
    }
    
    let result;

    // Handle different file types
    if (mimeType === 'application/pdf' || detectedFileType?.mime === 'application/pdf') {
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
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      fileType = 'docx';
      result = await extractTextFromDOCX(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'docx',
        processingTime
      });
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      fileType = 'pptx';
      result = await extractTextFromPPTX(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'pptx',
        processingTime
      });
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel') {
      fileType = mimeType.includes('openxmlformats') ? 'xlsx' : 'xls';
      result = await extractTextFromExcel(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType,
        processingTime
      });
    } else if (mimeType === 'application/msword') {
      fileType = 'doc';
      result = await extractTextFromDOC(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'doc',
        processingTime
      });
    } else if (mimeType === 'application/vnd.ms-powerpoint') {
      fileType = 'ppt';
      result = await extractTextFromPPT(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType: 'ppt',
        processingTime
      });
    } else if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'application/rtf') {
      fileType = mimeType.split('/')[1];
      result = await extractTextFromPlainText(req.file.buffer);
      
      const processingTime = Date.now() - startTime;
      monitoring.recordRequest({ 
        fileType, 
        processingTime, 
        success: true 
      });
      
      res.json({ 
        text: result,
        fileType,
        processingTime
      });
    } else if (detectedFileType && detectedFileType.mime.startsWith('image/')) {
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
    } else {
      monitoring.recordRequest({ 
        fileType: mimeType, 
        processingTime: Date.now() - startTime, 
        error: 'Unsupported file type', 
        success: false 
      });
      return res.status(400).json({ error: 'Unsupported file type: ' + mimeType });
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
app.listen(PORT, async () => {
  console.log(`🚀 OCR Server running on http://localhost:${PORT}`);
  console.log('📄 Supported file types: PDF, DOCX, PPTX, XLSX, DOC, PPT, XLS, TXT, CSV, RTF, PNG, JPEG, TIFF');
  console.log('⚡ Compression: Enabled');
  console.log('📊 Monitoring: Active');
  console.log('🚀 Performance: Worker pool + parallel processing');
  console.log(`💉 Test with: curl -X POST -F "file=@path/to/your/file.pdf" http://localhost:${PORT}/api/ocr`);
  
  // Initialize worker pool for fast OCR
  console.log('🔧 Initializing OCR worker pool...');
  await initWorkerPool();
  console.log('✅ Server ready for fast document processing!');
  
  // Start self-ping in production
  if (process.env.RENDER_EXTERNAL_URL || process.env.NODE_ENV === 'production') {
    startSelfPing();
  }
});
