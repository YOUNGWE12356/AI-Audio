import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_CATEGORIES, INITIAL_SOUNDS } from './src/data/sfxData';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON middleware with large payload support for categories/sounds state
  app.use(express.json({ limit: '50mb' }));

  // Directories paths
  const dataDir = path.join(process.cwd(), 'data');
  const uploadsDir = path.join(process.cwd(), 'uploads');

  // Ensure directories exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const categoriesFile = path.join(dataDir, 'categories.json');
  const soundsFile = path.join(dataDir, 'sounds.json');

  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));

  // --- API Endpoints ---

  // 1. Get Categories
  app.get('/api/sfx/categories', (req, res) => {
    try {
      if (fs.existsSync(categoriesFile)) {
        const content = fs.readFileSync(categoriesFile, 'utf-8');
        return res.json(JSON.parse(content));
      }
      return res.json(DEFAULT_CATEGORIES);
    } catch (err: any) {
      console.error('Error reading categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 2. Save Categories
  app.post('/api/sfx/categories', (req, res) => {
    try {
      const categories = req.body;
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'Invalid categories format' });
      }
      fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2), 'utf-8');
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error saving categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 3. Get Sound Effects
  app.get('/api/sfx/sounds', (req, res) => {
    try {
      if (fs.existsSync(soundsFile)) {
        const content = fs.readFileSync(soundsFile, 'utf-8');
        return res.json(JSON.parse(content));
      }
      return res.json(INITIAL_SOUNDS);
    } catch (err: any) {
      console.error('Error reading sounds:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 4. Save Sound Effects List
  app.post('/api/sfx/sounds', (req, res) => {
    try {
      const sounds = req.body;
      if (!Array.isArray(sounds)) {
        return res.status(400).json({ error: 'Invalid sounds format' });
      }
      fs.writeFileSync(soundsFile, JSON.stringify(sounds, null, 2), 'utf-8');
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error saving sounds:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 5. Raw File Upload Endpoint
  app.post('/api/sfx/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
    try {
      const originalFilename = req.headers['x-filename'] as string || `upload_${Date.now()}.wav`;
      
      // Clean and generate a unique safe filename to avoid overwrites and path injections
      const ext = path.extname(originalFilename) || '.wav';
      const base = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
      const cleanFilename = `${base}_${Date.now()}${ext}`;
      
      const filePath = path.join(uploadsDir, cleanFilename);
      
      fs.writeFileSync(filePath, req.body);
      
      console.log(`Successfully uploaded file: ${cleanFilename} (${req.body.length} bytes)`);
      return res.json({ 
        url: `/uploads/${cleanFilename}`,
        fileName: cleanFilename
      });
    } catch (err: any) {
      console.error('Error processing upload:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 6. Download File as Attachment (to bypass iframe download sandbox constraints)
  app.get('/api/sfx/download-file', (req, res) => {
    try {
      const filePathParam = req.query.path as string;
      const downloadName = req.query.name as string || 'download.mp3';
      if (!filePathParam) {
        return res.status(400).json({ error: 'Path parameter is required' });
      }
      
      // Prevent path traversal
      const safePath = path.normalize(filePathParam).replace(/^(\.\.(\/|\\))+/, '');
      const absolutePath = path.join(process.cwd(), safePath);
      
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      return fs.createReadStream(absolutePath).pipe(res);
    } catch (err: any) {
      console.error('Error downloading file:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // --- Vite & SPA integration ---
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite proxy...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
