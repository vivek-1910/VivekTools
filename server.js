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

  // Get the size of the uploaded PDF
  const fileSize = fs.statSync(inputPath).size / 1024; // File size in KB

  // Log the initial PDF size
  console.log(`Initial Compressed PDF Size: ${fileSize.toFixed(2)} KB`);

  // Default Ghostscript command with aggressive compression
  let gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

  // If the file size is too large, apply stronger compression
  if (fileSize > 5000) {
    console.log("Compression not sufficient, re-compressing...");
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dColorImageResolution=72 -dGrayImageResolution=72 -dDownsampleColorImages=true -dDownsampleGrayImages=true -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;
  } else if (fileSize > 1000) {
    console.log("File size moderate, applying medium compression...");
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dColorImageResolution=150 -dGrayImageResolution=150 -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;
  }

  // Execute the Ghostscript command for compression
  exec(gsCommand, (error) => {
    if (error) {
      console.error("Compression error:", error);
      return res.status(500).json({ error: "Compression failed" });
    }

    // Get the size of the compressed PDF
    const compressedFileSize = fs.statSync(outputPath).size / 1024; // File size in KB
    console.log(`Final Compressed PDF Size: ${compressedFileSize.toFixed(2)} KB`);

    // Return the compressed PDF to the client
    res.download(outputPath, "compressed.pdf", () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
