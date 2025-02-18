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

// Utility function to calculate file size in KB
const getFileSize = (filePath) => {
  const stats = fs.statSync(filePath);
  return stats.size / 1024; // Returns the file size in KB
};

app.post("/compress", upload.single("pdf"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath = path.join("/tmp", req.file.filename);
  let outputPath = path.join("/tmp", `compressed_${Date.now()}.pdf`);
  const desiredSize = req.body.size; // Size passed from the client (KB or MB)

  if (!desiredSize) {
    return res.status(400).json({ error: "Desired size not provided" });
  }

  let gsCommand = "";
  let pdfSettings = "-dPDFSETTINGS=/screen"; // Default compression settings
  let resolution = 72; // Default resolution (72 DPI for screen)
  let targetSize = parseInt(desiredSize.replace("KB", "").replace("MB", "").trim());
  
  // Validate size input format (KB or MB)
  if (desiredSize.endsWith("KB")) {
    targetSize = parseInt(desiredSize.replace("KB", "").trim());
  } else if (desiredSize.endsWith("MB")) {
    targetSize *= 1024; // Convert MB to KB for easier comparison
  } else {
    return res.status(400).json({ error: "Invalid size format. Please use KB or MB." });
  }

  // Compression settings based on size input
  if (targetSize < 100) {
    pdfSettings = "-dPDFSETTINGS=/ebook"; // Higher compression for smaller files
    resolution = 72;
  } else if (targetSize < 500) {
    pdfSettings = "-dPDFSETTINGS=/printer"; // Medium compression for medium size
    resolution = 150;
  } else {
    pdfSettings = "-dPDFSETTINGS=/prepress"; // Low compression for larger files
    resolution = 300;
  }

  // Ghostscript command with the determined settings
  gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 ${pdfSettings} -dNOPAUSE -dBATCH -r${resolution} -sOutputFile=${outputPath} ${inputPath}`;

  // Apply compression and check file size
  exec(gsCommand, (error) => {
    if (error) {
      console.error("Compression error:", error);
      return res.status(500).json({ error: "Compression failed" });
    }

    const compressedFileSize = getFileSize(outputPath); // Get the compressed file size in KB

    console.log(`Initial Compressed PDF Size: ${compressedFileSize} KB`);

    // If the file size is much larger than the target, apply further compression
    if (compressedFileSize > targetSize) {
      console.log("Compression not sufficient, re-compressing...");

      // Retry compression with stricter settings
      gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -r72 -sOutputFile=${outputPath} ${inputPath}`;

      exec(gsCommand, (retryError) => {
        if (retryError) {
          console.error("Retry compression error:", retryError);
          return res.status(500).json({ error: "Compression failed after retry" });
        }

        const finalCompressedSize = getFileSize(outputPath);
        console.log(`Final Compressed PDF Size: ${finalCompressedSize} KB`);

        if (finalCompressedSize <= targetSize) {
          res.download(outputPath, "compressed.pdf", () => {
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
          });
        } else {
          res.status(500).json({
            error: "Unable to compress PDF to the requested size.",
          });
        }
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
