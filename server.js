// Simple WebSocket server for multiplayer pole game
// Run with: node server.js

require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const { Server: SnowglobeServer, makeConfig } = require('@hastearcade/snowglobe');
const { MyWorld } = require('./src/my-world.js');
const { Net } = require('./src/net-resource.js');
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
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // Handle Server-Sent Events endpoint
    if (url.pathname === '/events') {
        handleSSE(req, res);
        return;
    }
    
    // Handle player state updates
    if (url.pathname === '/api/state' && req.method === 'POST') {
        handleStateUpdate(req, res);
        return;
    }
    
    // Handle player connection
    if (url.pathname === '/api/connect' && req.method === 'POST') {
        handlePlayerConnect(req, res);
        return;
    }
    
    // Handle WebSocket endpoint (still keep for backwards compatibility)
    if (req.url === '/ws/' || req.url === '/ws') {
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('Upgrade Required');
        return;
    }
    
    // Serve static files
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

const netServer = new Net(wss, true); // Pass the WebSocket server instance, true for isServer
// const makeWorld = () => new MyWorld(); // Server doesn't need getLocalAnetId, MyWorld constructor handles null/undefined
const serverWorldInstance = new MyWorld(); // Create one instance for the server
const sgConfig = makeConfig(); // Use default config for now
// sgConfig.lagCompensation = false; // Example: Disable lag compensation if desired initially
// sgConfig.maxPredictionFrames = 10; // Example
const snowglobeServer = new SnowglobeServer(serverWorldInstance, sgConfig, 0); // 0 is conventional serverAnetId

// let clients = new Map(); // Replaced by netServer.clients
let sseClients = new Map(); // For SSE connections

// Server-side optimization variables
let lastBroadcastTime = 0;
const BROADCAST_INTERVAL = 50; // Broadcast every 50ms (20 FPS)
let pendingBroadcast = false;

// Server data usage tracking
let totalBroadcastBytes = 0;
let totalBroadcasts = 0;
let lastServerStatsTime = Date.now();

function randomColor() {
    return `hsl(${Math.floor(Math.random()*360)}, 80%, 60%)`;
}

// SSE handler
function handleSSE(req, res) {
    // Set headers for Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    const clientId = Math.random().toString(36).substr(2, 9);
    const color = randomColor();
    
    const client = {
        id: clientId,
        color: color,
        state: null,
        res: res,
        lastActivity: Date.now()
    };
    
    sseClients.set(clientId, client);
    
    // Send initial data
    res.write(`data: ${JSON.stringify({ type: 'init', id: clientId, color: color })}\n\n`);
    
    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        } catch (error) {
            clearInterval(heartbeatInterval);
            sseClients.delete(clientId);
        }
    }, 5000); // Send heartbeat every 5 seconds
    
    // Store heartbeat interval for cleanup
    client.heartbeatInterval = heartbeatInterval;
    
    // Handle client disconnect
    req.on('close', () => {
        if (client.heartbeatInterval) {
            clearInterval(client.heartbeatInterval);
        }
        sseClients.delete(clientId);
        console.log(`SSE client ${clientId} disconnected`);
    });
    
    req.on('error', () => {
        if (client.heartbeatInterval) {
            clearInterval(client.heartbeatInterval);
        }
        sseClients.delete(clientId);
    });
    
    console.log(`SSE client ${clientId} connected`);
}

// Handle state updates via POST
function handleStateUpdate(req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const clientId = data.id;
            
            if (sseClients.has(clientId)) {
                const client = sseClients.get(clientId);
                client.state = data.state;
                client.lastActivity = Date.now();
                
                // Schedule broadcast with rate limiting
                scheduleBroadcast();
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"status":"ok"}');
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('{"error":"invalid json"}');
        }
    });
}

function scheduleBroadcast() {
    if (pendingBroadcast) return;
    
    const now = Date.now();
    const timeSinceLastBroadcast = now - lastBroadcastTime;
    
    if (timeSinceLastBroadcast >= BROADCAST_INTERVAL) {
        // Broadcast immediately
        broadcastStates();
    } else {
        // Schedule broadcast for later
        pendingBroadcast = true;
        setTimeout(() => {
            pendingBroadcast = false;
            broadcastStates();
        }, BROADCAST_INTERVAL - timeSinceLastBroadcast);
    }
}

// Handle player connection
function handlePlayerConnect(req, res) {
    // This endpoint can be used for initial handshake if needed
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"connected"}');
}

function broadcastStates() {
    const now = Date.now();
    lastBroadcastTime = now;
    
    const allStates = Array.from(sseClients.values())
        .map(c => ({ id: c.id, color: c.color, state: c.state }))
        .filter(c => c.state);
    
    // Only broadcast if there are states to send
    if (allStates.length === 0) return;
    
    const message = `data: ${JSON.stringify({ type: 'states', all: allStates })}\n\n`;
    
    // Track server data usage
    totalBroadcastBytes += message.length * sseClients.size;
    totalBroadcasts++;
    
    // Log server stats every 10 seconds
    if (now - lastServerStatsTime > 10000) {
        const avgBytesPerSecond = totalBroadcastBytes / 10;
        console.log(`📡 Server broadcast: ${totalBroadcasts} broadcasts, ${totalBroadcastBytes} bytes, ${(avgBytesPerSecond/1024).toFixed(2)} KB/s`);
        totalBroadcastBytes = 0;
        totalBroadcasts = 0;
        lastServerStatsTime = now;
    }
    
    // Send to all SSE clients
    const toRemove = [];
    for (let [clientId, client] of sseClients) {
        try {
            client.res.write(message);
        } catch (error) {
            // Mark dead connections for removal
            console.log(`Dead SSE connection detected: ${clientId}`);
            if (client.heartbeatInterval) {
                clearInterval(client.heartbeatInterval);
            }
            toRemove.push(clientId);
        }
    }
    
    // Remove dead connections
    toRemove.forEach(clientId => sseClients.delete(clientId));
}

// Clean up inactive clients every 30 seconds
setInterval(() => {
    const now = Date.now();
    for (let [clientId, client] of sseClients) {
        if (now - client.lastActivity > 60000) { // 1 minute timeout
            try {
                if (client.heartbeatInterval) {
                    clearInterval(client.heartbeatInterval);
                }
                client.res.end();
            } catch (e) {}
            sseClients.delete(clientId);
            console.log(`Removed inactive SSE client ${clientId}`);
        }
    }
}, 30000);

server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws/' || req.url === '/ws') {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

// The old wss.on('connection', ...) block, previously here, is now entirely removed.
// WebSocket connections are handled by the `Net` class instance (`netServer`)
// which is passed the `wss` object upon instantiation.
// The `netServer` handles 'connection' events from `wss` internally.

// Game Loop for Snowglobe
const GAME_TICK_RATE = 60; // Hz
const TICK_INTERVAL_MS = 1000 / GAME_TICK_RATE;
let lastTickTime = Date.now();

function gameLoop() {
    const now = Date.now();
    const deltaSeconds = (now - lastTickTime) / 1000;
    lastTickTime = now;

    // Update Snowglobe server
    // The netServer instance allows Snowglobe to receive incoming messages and send outgoing ones.
    snowglobeServer.update(deltaSeconds, now / 1000, netServer);
    
    // Snowglobe's server.update() will call netServer.send() for snapshots/reliable messages.
    // It will also process messages queued in netServer.messageQueue via netServer.receive().
}

setInterval(gameLoop, TICK_INTERVAL_MS);

server.listen(useHTTPS ? HTTPS_PORT : PORT, () => {
    console.log(`🚀 Server running on ${useHTTPS ? 'HTTPS' : 'HTTP'} port ${useHTTPS ? HTTPS_PORT : PORT}`);
    console.log(`🔄 Snowglobe integrated with WebSocket endpoint: ${useHTTPS ? 'wss' : 'ws'}://localhost:${useHTTPS ? HTTPS_PORT : PORT}/ws`);
    console.log(`🔄 SSE endpoint: ${useHTTPS ? 'https' : 'http'}://localhost:${useHTTPS ? HTTPS_PORT : PORT}/events`); // Kept as per instructions
    console.log(`⚡ Game loop running at ${GAME_TICK_RATE} Hz.`);
});
