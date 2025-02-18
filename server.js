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

    const gsCommand = `/usr/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

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
