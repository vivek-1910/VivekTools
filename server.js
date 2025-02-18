const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

const upload = multer({ dest: "/tmp" });

app.get("/", (req, res) => {
  res.send("PDF Compression Server is Running!");
});

app.post("/compress", upload.single("pdf"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath = path.join("/tmp", req.file.filename);
  const outputPath = path.join("/tmp", `compressed_${req.file.filename}`);

  const compressionLevel = req.body.compression || "medium"; 

  const fileSize = fs.statSync(inputPath).size / 1024; 

  console.log(`Initial PDF Size: ${fileSize.toFixed(2)} KB`);

  const baseResolution = 150; 

  let gsCommand;

  let adjustedResolution;
  if (compressionLevel === "more") {
    adjustedResolution = Math.round(baseResolution / 4); 
    console.log("Applying more compression...");
  } else if (compressionLevel === "medium") {
    adjustedResolution = Math.round(baseResolution / 2); 
    console.log("Applying medium compression...");
  } else {
    adjustedResolution = Math.round(baseResolution); 
    console.log("Applying less compression...");
  }

  gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dColorImageResolution=${adjustedResolution} -dGrayImageResolution=${adjustedResolution} -dDownsampleColorImages=true -dDownsampleGrayImages=true -dRemoveAllAnnotations=true -dOptimize=true -dAutoFilterColorImages=true -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

  console.log("Running Ghostscript command:", gsCommand);

  exec(gsCommand, (error) => {
    if (error) {
      console.error("Compression error:", error);
      return res.status(500).json({ error: "Compression failed" });
    }

    const compressedFileSize = fs.statSync(outputPath).size / 1024; 
    console.log(`Final Compressed PDF Size: ${compressedFileSize.toFixed(2)} KB`);

    res.download(outputPath, "compressed.pdf", () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
