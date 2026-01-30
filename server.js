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

function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

app.post('/api/admin/generate-key', (req, res) => {
    const { duration } = req.body;
    const prefix = "sk_live_";
    const key = prefix + generateId();
    
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
    // Ensure data integrity on load
    myProjects.forEach(p => { 
        if(!p.owner) p.owner = email; 
        if(!p.publicId) p.publicId = generateId();
        p.files.forEach(f => {
            if(!f.publicId) f.publicId = generateId();
            if(!f.history) f.history = [];
        });
    });

    let sharedProjects = [];
    Object.keys(db.projects).forEach(ownerEmail => {
        if (ownerEmail === email) return;
        const ownerProjs = db.projects[ownerEmail];
        if (ownerProjs) {
            const shared = ownerProjs.filter(p => p.collaborators && p.collaborators.includes(email));
            shared.forEach(p => {
                if(!p.owner) p.owner = ownerEmail;
                if(!p.publicId) p.publicId = generateId(); 
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
        // Ensure IDs exist before saving
        projects.forEach(p => {
            if (!p.publicId) p.publicId = generateId();
            p.files.forEach(f => {
                if (!f.publicId) f.publicId = generateId();
                if (!f.history) f.history = [];
            });
        });

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

// RAW ROUTE: Uses Random IDs
app.get('/raw/:pid/:fid', (req, res) => {
    const pid = req.params.pid;
    const fid = req.params.fid;
    
    let foundFile = null;
    
    const allEmails = Object.keys(db.projects);
    for (const email of allEmails) {
        const projs = db.projects[email];
        // Search by publicId
        const match = projs.find(p => p.publicId === pid);
        if (match) {
            const file = match.files.find(f => f.publicId === fid);
            if (file) {
                foundFile = file;
                break;
            }
        }
    }

    if (foundFile) {
        res.setHeader('Content-Type', 'text/plain');
        res.send(foundFile.content);
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
