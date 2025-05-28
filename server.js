// Simple WebSocket server for multiplayer pole game
// Run with: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    filePath = path.join(__dirname, filePath);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
        } else {
            let ext = path.extname(filePath);
            let type = 'text/html';
            if (ext === '.js') type = 'application/javascript';
            res.writeHead(200, { 'Content-Type': type });
            res.end(data);
        }
    });
});

const wss = new WebSocket.Server({ server });

let clients = new Map();

function randomColor() {
    return `hsl(${Math.floor(Math.random()*360)}, 80%, 60%)`;
}

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

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
