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

  // Determine the appropriate Ghostscript settings based on the desired size
  if (desiredSize.endsWith("KB")) {
    // Convert KB to approximate resolution (this is just a basic approach for illustration)
    const kbSize = parseInt(desiredSize.replace("KB", "").trim());
    const resolution = Math.max(72, kbSize / 10); // Higher compression for smaller file size
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -r${resolution} -sOutputFile=${outputPath} ${inputPath}`;
  } else if (desiredSize.endsWith("MB")) {
    // Convert MB to approximate resolution
    const mbSize = parseInt(desiredSize.replace("MB", "").trim());
    const resolution = Math.max(72, mbSize * 10); // Higher resolution for larger file size
    gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -r${resolution} -sOutputFile=${outputPath} ${inputPath}`;
  } else {
    return res.status(400).json({ error: "Invalid size format. Please use KB or MB." });
  }

  exec(gsCommand, (error) => {
    if (error) {
      console.error("Compression error:", error);
      return res.status(500).json({ error: "Compression failed" });
    }

    res.download(outputPath, "compressed.pdf", () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
