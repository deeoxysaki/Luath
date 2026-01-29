const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- CONFIGURATION ---
const DB_FILE = 'database.json';
// FAIL-SAFE KEY: This key will ALWAYS work, even if the database wipes.
const MASTER_KEY = "aethel-master-key-2024"; 

// --- DATABASE HANDLER ---
let db = {
    apiKeys: [],
    projects: {}, 
    settings: {},  
    registrations: [] 
};

// Load existing data
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE));
    } catch(e) {
        console.log("Database file invalid, starting fresh.");
    }
} else {
    // Create file immediately if it doesn't exist
    saveDB();
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Error saving DB:", e);
    }
}

// --- ROUTES ---

// 1. ADMIN: Generate Key
app.post('/api/admin/generate-key', (req, res) => {
    const { duration } = req.body;
    const prefix = "sk_live_";
    const key = prefix + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (duration * 24 * 60 * 60 * 1000));
    
    const newKey = {
        key,
        expiresAt: expiresAt.toISOString(),
        duration,
        usedBy: 'Unclaimed',
        createdAt: now.toISOString()
    };
    
    db.apiKeys.push(newKey);
    saveDB();
    
    console.log("New Key Generated:", key); // Log for debugging on Render Dashboard
    res.json({ success: true, key: newKey.key, keys: db.apiKeys });
});

// 2. GET KEYS
app.get('/api/admin/keys', (req, res) => res.json(db.apiKeys));
app.get('/api/admin/registrations', (req, res) => res.json(db.registrations));

// 3. AUTH: LOGIN
app.post('/api/auth/key-login', (req, res) => {
    const { key, email } = req.body;
    console.log(`Login attempt for ${email} with key: ${key}`);

    // CHECK 1: Is it the Master Key?
    if (key === MASTER_KEY) {
        // Log user if not already logged
        if (!db.registrations.find(r => r.email === email)) {
            db.registrations.push({ email, key: "MASTER_KEY", usedDate: new Date().toISOString() });
            saveDB();
        }
        return res.json({ success: true, role: 'Developer Access' });
    }

    // CHECK 2: Is it a Generated Key?
    const keyData = db.apiKeys.find(k => k.key === key);
    
    if (!keyData) {
        console.log("Key not found in DB");
        return res.status(401).json({ error: "Invalid Key" });
    }
    
    if (new Date() > new Date(keyData.expiresAt)) {
        console.log("Key expired");
        return res.status(401).json({ error: "Key Expired" });
    }
    
    // Bind Key
    if (keyData.usedBy === 'Unclaimed') {
        keyData.usedBy = email;
        keyData.usedDate = new Date().toISOString();
        
        const existingReg = db.registrations.find(r => r.email === email);
        if (!existingReg) {
            db.registrations.push({ email, key, usedDate: new Date().toISOString() });
        }
        saveDB();
    }
    
    res.json({ success: true, role: 'Developer Access' });
});

// 4. USER DATA SYNC
app.get('/api/user/data', (req, res) => {
    const email = req.query.email;
    res.json({
        projects: db.projects[email] || [],
        settings: db.settings[email] || {}
    });
});

app.post('/api/user/data', (req, res) => {
    const { email, projects, settings } = req.body;
    if (email) {
        if (projects) db.projects[email] = projects;
        if (settings) db.settings[email] = settings;
        saveDB();
    }
    res.json({ success: true });
});

// SERVE FILES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/raw/*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, () => console.log(`Server running on port ${port}`));
