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

  const compressionLevel = req.body.compression || "medium"; // Default to "medium" if no option is selected

  // Get the size of the uploaded PDF
  const fileSize = fs.statSync(inputPath).size / 1024; // File size in KB

  // Log the initial PDF size
  console.log(`Initial PDF Size: ${fileSize.toFixed(2)} KB`);

  // Assuming the PDF has images with a base resolution (e.g., 150 dpi)
  const baseResolution = 150; // Default value for PDF images (can be extracted if needed)

  let gsCommand;

  // Calculate adjusted resolution for each compression level
  let adjustedResolution;
  if (compressionLevel === "more") {
    adjustedResolution = Math.round(baseResolution / 4); // Round to nearest integer for more compression
    console.log("Applying more compression...");
  } else if (compressionLevel === "medium") {
    adjustedResolution = Math.round(baseResolution / 2); // Round to nearest integer for medium compression
    console.log("Applying medium compression...");
  } else {
    adjustedResolution = Math.round(baseResolution); // Same resolution for less compression
    console.log("Applying less compression...");
  }

  // Construct the Ghostscript command based on the adjusted resolution
  gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dColorImageResolution=${adjustedResolution} -dGrayImageResolution=${adjustedResolution} -dDownsampleColorImages=true -dDownsampleGrayImages=true -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

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
