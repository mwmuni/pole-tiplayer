// Simple WebSocket server for multiplayer pole game
// Run with: node server.js

require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;

// Check if we should use HTTPS (for Cloudflare "Full" mode)
const useHTTPS = process.env.USE_HTTPS === 'true';

let server;
if (useHTTPS) {
    // For production with SSL certificates
    const sslOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || '/home/sieyk/pole-tiplayer/key.pem'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || '/home/sieyk/pole-tiplayer/cert.pem')
    };
    server = https.createServer(sslOptions, requestHandler);
} else {
    // Simple HTTP server - Cloudflare will handle SSL termination
    server = http.createServer(requestHandler);
}

function requestHandler(req, res) {
    // Serve static files except for /ws/
    if (req.url === '/ws/' || req.url === '/ws') {
        // Let 'upgrade' event handle WebSocket
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('Upgrade Required');
        return;
    }
    let filePath = req.url.split('?')[0]; // Strip query string
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    filePath = path.join(__dirname, filePath);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        } else {
            let ext = path.extname(filePath).toLowerCase();
            let type = 'text/plain';
            if (ext === '.html') type = 'text/html';
            else if (ext === '.js') type = 'application/javascript';
            else if (ext === '.css') type = 'text/css';
            else if (ext === '.json') type = 'application/json';
            else if (ext === '.png') type = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') type = 'image/jpeg';
            res.writeHead(200, { 'Content-Type': type });
            res.end(data);
        }
    });
}

const wss = new WebSocket.Server({ noServer: true });

let clients = new Map();

function randomColor() {
    return `hsl(${Math.floor(Math.random()*360)}, 80%, 60%)`;
}

server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws/' || req.url === '/ws') {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', ws => {
    const id = Math.random().toString(36).substr(2, 9);
    const color = randomColor();
    clients.set(ws, { id, color, state: null });
    ws.send(JSON.stringify({ type: 'init', id, color }));

    ws.on('message', msg => {
        let data;
        try { data = JSON.parse(msg); } catch { return; }
        if (data.type === 'state') {
            clients.get(ws).state = data.state;
            // Broadcast all states to everyone
            const allStates = Array.from(clients.values()).map(c => ({ id: c.id, color: c.color, state: c.state })).filter(c => c.state);
            for (let client of clients.keys()) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'states', all: allStates }));
                }
            }
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

server.listen(useHTTPS ? HTTPS_PORT : PORT, () => {
    console.log(`WebSocket server running on port ${useHTTPS ? HTTPS_PORT : PORT}`);
    console.log(`Origin protocol: ${useHTTPS ? 'HTTPS' : 'HTTP'}`);
    if (useHTTPS) {
        console.log(`Local access: wss://localhost:${HTTPS_PORT}/ws/`);
    } else {
        console.log(`Local access: ws://localhost:${PORT}/ws/`);
        console.log(`When accessed via Cloudflare (HTTPS): wss://your-domain.com/ws/ (proxied to http://localhost:${PORT}/ws/)`);
    }
});
