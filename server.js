const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const DB_FILE = 'database.json';
const MASTER_KEY = "aethel-master-key-2024"; 

let db = {
    apiKeys: [],
    projects: {}, 
    settings: {}, 
    registrations: [] 
};

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE));
    } catch(e) {
        console.log("DB reset");
    }
} else {
    saveDB();
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error(e);
    }
}

app.post('/api/admin/generate-key', (req, res) => {
    const { duration } = req.body;
    const prefix = "sk_live_";
    const key = prefix + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (duration * 24 * 60 * 60 * 1000));
    
    const newKey = {
        key,
        expiresAt: expiresAt.toISOString(),
        duration: parseInt(duration),
        usedBy: 'Unclaimed',
        createdAt: now.toISOString()
    };
    
    db.apiKeys.push(newKey);
    saveDB();
    
    res.json({ success: true, key: newKey.key, keys: db.apiKeys });
});

app.post('/api/admin/expire-key', (req, res) => {
    const { key } = req.body;
    const keyIndex = db.apiKeys.findIndex(k => k.key === key);
    if (keyIndex > -1) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        db.apiKeys[keyIndex].expiresAt = yesterday.toISOString();
        saveDB();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Key not found" });
    }
});

app.post('/api/admin/extend-key', (req, res) => {
    const { key, duration } = req.body;
    const keyIndex = db.apiKeys.findIndex(k => k.key === key);
    if (keyIndex > -1) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (duration * 24 * 60 * 60 * 1000));
        db.apiKeys[keyIndex].expiresAt = expiresAt.toISOString();
        db.apiKeys[keyIndex].duration = parseInt(duration);
        saveDB();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Key not found" });
    }
});

app.get('/api/admin/keys', (req, res) => res.json(db.apiKeys));
app.get('/api/admin/registrations', (req, res) => res.json(db.registrations));

app.post('/api/auth/key-login', (req, res) => {
    const { key, email } = req.body;
    
    if (key === MASTER_KEY) {
        if (!db.registrations.find(r => r.email === email)) {
            db.registrations.push({ email, key: "MASTER_KEY", usedDate: new Date().toISOString() });
            saveDB();
        }
        return res.json({ success: true, role: 'Developer Access' });
    }

    const keyData = db.apiKeys.find(k => k.key === key);
    
    if (!keyData) return res.status(401).json({ error: "Invalid Key" });
    if (new Date() > new Date(keyData.expiresAt)) return res.status(401).json({ error: "Key Expired" });
    
    if (keyData.usedBy === 'Unclaimed') {
        keyData.usedBy = email;
        keyData.usedDate = new Date().toISOString();
        if (!db.registrations.find(r => r.email === email)) {
            db.registrations.push({ email, key, usedDate: new Date().toISOString() });
        }
        saveDB();
    } else if (keyData.usedBy !== email) {
        return res.status(401).json({ error: "Key already used by another email" });
    }
    
    res.json({ success: true, role: 'Developer Access' });
});

app.get('/api/user/search', (req, res) => {
    const query = req.query.q.toLowerCase();
    if (!query) return res.json([]);

    const matches = db.registrations.filter(r => r.email.toLowerCase().includes(query)).map(r => ({
        email: r.email,
        username: db.settings[r.email]?.username || r.email.split('@')[0]
    }));
    res.json(matches);
});

app.get('/api/user/data', (req, res) => {
    const email = req.query.email;
    if (!email) return res.json({ projects: [], settings: {} });

    let myProjects = db.projects[email] || [];
    myProjects.forEach(p => { if(!p.owner) p.owner = email; });

    let sharedProjects = [];
    Object.keys(db.projects).forEach(ownerEmail => {
        if (ownerEmail === email) return;
        const ownerProjs = db.projects[ownerEmail];
        if (ownerProjs) {
            const shared = ownerProjs.filter(p => p.collaborators && p.collaborators.includes(email));
            shared.forEach(p => {
                if(!p.owner) p.owner = ownerEmail; 
            });
            sharedProjects = sharedProjects.concat(shared);
        }
    });

    res.json({
        projects: [...myProjects, ...sharedProjects],
        settings: db.settings[email] || {}
    });
});

app.post('/api/user/data', (req, res) => {
    const { email, projects, settings } = req.body;
    if (!email) return res.status(400).json({ error: "No email" });

    if (settings) db.settings[email] = settings;

    if (projects) {
        const owned = projects.filter(p => !p.owner || p.owner === email);
        owned.forEach(p => p.owner = email);
        db.projects[email] = owned;

        const shared = projects.filter(p => p.owner && p.owner !== email);
        shared.forEach(sharedProj => {
            const ownerEmail = sharedProj.owner;
            if (db.projects[ownerEmail]) {
                const index = db.projects[ownerEmail].findIndex(p => p.id === sharedProj.id);
                if (index !== -1) {
                    db.projects[ownerEmail][index] = sharedProj;
                }
            }
        });
    }
    
    saveDB();
    res.json({ success: true });
});

app.get('/raw/:project/:file', (req, res) => {
    const pName = decodeURIComponent(req.params.project);
    const fName = decodeURIComponent(req.params.file);
    
    let foundFile = null;
    let foundProj = null;

    const allEmails = Object.keys(db.projects);
    for (const email of allEmails) {
        const projs = db.projects[email];
        const match = projs.find(p => p.name === pName);
        if (match) {
            const file = match.files.find(f => f.name === fName);
            if (file) {
                foundFile = file;
                foundProj = match;
                break;
            }
        }
    }

    if (foundFile) {
        res.setHeader('Content-Type', 'text/html');
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${fName} (Raw)</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { background-color: #0e0e0e; color: #f8f8f2; font-family: monospace; margin: 0; padding: 20px; white-space: pre-wrap; word-wrap: break-word; }
                </style>
            </head>
            <body>${foundFile.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body>
            </html>
        `);
    } else {
        res.status(404).send('404: File Not Found');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at port ${port}`);
});
