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
  const outputPath = path.join("/tmp", `compressed_${req.file.filename}`);

  // Get the size of the uploaded PDF
  const fileSize = fs.statSync(inputPath).size / 1024; // File size in KB

  // Log the initial PDF size
  console.log(`Initial Compressed PDF Size: ${fileSize.toFixed(2)} KB`);

  // Default Ghostscript command for aggressive compression (screen setting)
  let gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

  // Apply stronger compression if the file size is large
  if (fileSize > 5000) {
    console.log("Compression not sufficient, re-compressing...");
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dColorImageResolution=72 -dGrayImageResolution=72 -dDownsampleColorImages=true -dDownsampleGrayImages=true -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;
  } else if (fileSize > 1000) {
    console.log("File size moderate, applying medium compression...");
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dColorImageResolution=150 -dGrayImageResolution=150 -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;
  }

  // Log the Ghostscript command to be run
  console.log("Running Ghostscript command:", gsCommand);

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
