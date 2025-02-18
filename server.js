const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

const upload = multer({ dest: "/tmp" }); // Use /tmp for Render

app.get("/", (req, res) => {
  res.send("PDF Compression Server is Running!");
});

app.post("/compress", upload.single("pdf"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath = path.join("/tmp", req.file.filename);
  const outputPath = path.join("/tmp", `compressed_${Date.now()}.pdf`);
  const desiredSize = req.body.size; // Size passed from the client (KB or MB)

  if (!desiredSize) {
    return res.status(400).json({ error: "Desired size not provided" });
  }

  let gsCommand = "";
  let pdfSettings = "-dPDFSETTINGS=/screen"; // Default compression settings
  let resolution = 72; // Default resolution (72 DPI for screen)
  
  // Determine the appropriate Ghostscript settings based on the desired size
  if (desiredSize.endsWith("KB")) {
    // Convert KB to an approximate resolution
    const kbSize = parseInt(desiredSize.replace("KB", "").trim());
    if (kbSize < 100) {
      pdfSettings = "-dPDFSETTINGS=/ebook"; // Better compression for very small file sizes
      resolution = 72; // Lower resolution for smaller file sizes
    } else if (kbSize < 500) {
      pdfSettings = "-dPDFSETTINGS=/printer";
      resolution = 150; // Slightly better resolution for medium size
    } else {
      pdfSettings = "-dPDFSETTINGS=/prepress";
      resolution = 300; // Higher resolution for larger files
    }
  } else if (desiredSize.endsWith("MB")) {
    // Convert MB to an approximate resolution
    const mbSize = parseInt(desiredSize.replace("MB", "").trim());
    if (mbSize < 1) {
      pdfSettings = "-dPDFSETTINGS=/screen";
      resolution = 72; // For smaller files
    } else if (mbSize < 5) {
      pdfSettings = "-dPDFSETTINGS=/ebook";
      resolution = 150; // Medium size PDFs
    } else {
      pdfSettings = "-dPDFSETTINGS=/printer";
      resolution = 300; // Higher quality for larger PDFs
    }
  } else {
    return res.status(400).json({ error: "Invalid size format. Please use KB or MB." });
  }

  // Ghostscript command with appropriate settings
  gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 ${pdfSettings} -dNOPAUSE -dBATCH -r${resolution} -sOutputFile=${outputPath} ${inputPath}`;

  exec(gsCommand, (error) => {
    if (error) {
      console.error("Compression error:", error);
      return res.status(500).json({ error: "Compression failed" });
    }

    // Check if the file size meets the desired size (this can be fine-tuned later)
    const compressedFileSize = fs.statSync(outputPath).size / 1024; // Size in KB
    console.log("Compressed PDF Size:", compressedFileSize);

    // If the compressed size is much larger than the target, adjust and re-compress (basic approach)
    if (compressedFileSize > parseInt(desiredSize.replace("KB", "").replace("MB", ""))) {
      console.log("Compression not sufficient, re-compressing...");
      // Re-run compression with stronger settings if size isn't met
      exec(gsCommand, (retryError) => {
        if (retryError) {
          console.error("Retry compression error:", retryError);
          return res.status(500).json({ error: "Compression failed after retry" });
        }
        res.download(outputPath, "compressed.pdf", () => {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        });
      });
    } else {
      res.download(outputPath, "compressed.pdf", () => {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
