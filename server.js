const express = require('express');
const path = require('path');
const app = express();

// Use the environment port (for Render) or 3000 for local testing
const port = process.env.PORT || 3000;

// Serve static files (css, images, etc.) from the current directory
app.use(express.static(__dirname));

// Main route: Send the index.html file when someone visits the site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the "Raw" view route
// This ensures that if you refresh the page on a raw link, it doesn't break
app.get('/raw/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Aethel Locker is running!`);
    console.log(`Local address: http://localhost:${port}`);
});
