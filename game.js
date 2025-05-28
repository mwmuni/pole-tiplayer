// Simple pole physics game
// One end of the pole is locked to the mouse, the other dangles with gravity

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Resize canvas to fill window
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Pole parameters
const poleLength = 200;
const poleWidth = 8;
const gravity = 0.5;
const damping = 0.995;

// Pole state: one end is at the mouse, the other is free
let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let pole = {
    x: mouse.x + poleLength, // free end
    y: mouse.y,
    vx: 0,
    vy: 0
};

// Mouse tracking
canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

let myId = null;
let myColor = '#FFD700';
let others = {};
let eventSource;
let connectionType = 'SSE'; // Changed from WebSocket to SSE
let lastHeartbeat = Date.now();
let connectionAttempts = 0;
let maxReconnectDelay = 30000; // Max 30 seconds between reconnects

// Optimization variables
let lastSentState = null;
let lastSendTime = 0;
const SEND_INTERVAL = 50; // Send every 50ms (20 FPS instead of 60)
const MOVEMENT_THRESHOLD = 2; // Minimum movement to trigger update
const PRECISION = 1; // Round to 1 decimal place

// Rollback netcode variables
const STATE_HISTORY_SIZE = 120; // 2 seconds at 60 FPS
let stateHistory = []; // Local state history for rollback
let confirmedStates = new Map(); // Server-confirmed states by timestamp
let inputHistory = []; // Input history for replay
let currentFrame = 0;
let lastConfirmedFrame = 0;

// Data usage tracking
let totalBytesSent = 0;
let totalMessagesSent = 0;
let lastStatsTime = Date.now();

function connectSSE() {
    connectionAttempts++;
    const delay = Math.min(1000 * Math.pow(2, connectionAttempts - 1), maxReconnectDelay);
    
    console.log(`🔄 Attempting SSE connection (attempt ${connectionAttempts}): ${location.protocol}//${location.host}/events`);
    console.log(`Page loaded via: ${location.protocol}//${location.host}`);
    
    // Close existing connection if any
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    
    // Create new EventSource connection
    eventSource = new EventSource('/events');
    
    eventSource.onopen = () => {
        console.log('✅ SSE connected successfully!');
        console.log('Connection type: Server-Sent Events + AJAX');
        connectionAttempts = 0; // Reset attempts on successful connection
        lastHeartbeat = Date.now();
    };
    
    eventSource.onerror = (error) => {
        console.error('❌ SSE error:', error);
        console.error('SSE ready state:', eventSource?.readyState);
        
        // Always try to reconnect on error
        eventSource.close();
        eventSource = null;
        myId = null; // Reset ID so we get a new one
        
        console.log(`🔌 SSE connection failed, reconnecting in ${delay/1000}s...`);
        setTimeout(connectSSE, delay);
    };
    
    eventSource.onmessage = (event) => {
        try {
            lastHeartbeat = Date.now();
            let data = JSON.parse(event.data);
            if (data.type === 'init') {
                myId = data.id;
                myColor = data.color;
                console.log(`🎮 Player initialized: ID=${myId}, Color=${myColor}`);
            } else if (data.type === 'states') {
                others = {};
                for (let c of data.all) {
                    if (c.id !== myId) {
                        // Decompress the state data
                        if (c.state && c.state.m && c.state.p) {
                            others[c.id] = {
                                ...c,
                                state: {
                                    mouse: { x: c.state.m.x, y: c.state.m.y },
                                    pole: { 
                                        x: c.state.p.x, 
                                        y: c.state.p.y,
                                        vx: c.state.p.vx || 0,
                                        vy: c.state.p.vy || 0
                                    }
                                }
                            };
                        } else {
                            others[c.id] = c;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing SSE message:', error);
        }
    };
}

// Heartbeat monitor - check if connection is still alive
setInterval(() => {
    const timeSinceLastMessage = Date.now() - lastHeartbeat;
    if (timeSinceLastMessage > 10000) { // No message for 10 seconds
        console.log('💔 SSE connection appears dead, forcing reconnect...');
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        myId = null;
        connectSSE();
    }
}, 5000); // Check every 5 seconds

// Start SSE connection
connectSSE();

function roundValue(value) {
    return Math.round(value * Math.pow(10, PRECISION)) / Math.pow(10, PRECISION);
}

function hasSignificantMovement(newState, oldState) {
    if (!oldState) return true;
    
    const dx = Math.abs(newState.mouse.x - oldState.mouse.x);
    const dy = Math.abs(newState.mouse.y - oldState.mouse.y);
    const pdx = Math.abs(newState.pole.x - oldState.pole.x);
    const pdy = Math.abs(newState.pole.y - oldState.pole.y);
    
    return dx > MOVEMENT_THRESHOLD || dy > MOVEMENT_THRESHOLD || 
           pdx > MOVEMENT_THRESHOLD || pdy > MOVEMENT_THRESHOLD;
}

function compressState() {
    // Use shorter property names and round values to reduce data size
    return {
        m: { // mouse
            x: roundValue(mouse.x),
            y: roundValue(mouse.y)
        },
        p: { // pole
            x: roundValue(pole.x),
            y: roundValue(pole.y),
            vx: roundValue(pole.vx),
            vy: roundValue(pole.vy)
        }
    };
}

async function sendState() {
    if (!myId) return;
    
    const now = Date.now();
    // Rate limiting: only send updates every SEND_INTERVAL ms
    if (now - lastSendTime < SEND_INTERVAL) return;
    
    const currentState = compressState();
    
    // Only send if there's significant movement
    if (!hasSignificantMovement(
        { mouse: { x: currentState.m.x, y: currentState.m.y }, 
          pole: { x: currentState.p.x, y: currentState.p.y } },
        lastSentState ? 
          { mouse: { x: lastSentState.m.x, y: lastSentState.m.y }, 
            pole: { x: lastSentState.p.x, y: lastSentState.p.y } } : 
          null
    )) {
        return;
    }
    
    try {
        const payload = JSON.stringify({
            id: myId,
            state: currentState
        });
        
        const response = await fetch('/api/state', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: payload
        });
        
        if (response.ok) {
            lastSentState = currentState;
            lastSendTime = now;
            
            // Track data usage
            totalBytesSent += payload.length;
            totalMessagesSent++;
            
            // Log stats every 10 seconds
            if (now - lastStatsTime > 10000) {
                const avgBytesPerSecond = totalBytesSent / ((now - (lastStatsTime - 10000)) / 1000);
                console.log(`📊 Data usage: ${totalMessagesSent} msgs, ${totalBytesSent} bytes, ${(avgBytesPerSecond/1024).toFixed(2)} KB/s`);
                lastStatsTime = now;
            }
        } else {
            console.warn('Failed to send state:', response.status);
        }
    } catch (error) {
        console.warn('Error sending state:', error);
    }
}

function segmentDistance(ax, ay, bx, by, cx, cy, dx, dy) {
    // Returns the minimum distance between segment AB and segment CD
    // https://stackoverflow.com/a/1501725
    function sqr(x) { return x * x; }
    function dist2(v, w) { return sqr(v[0] - w[0]) + sqr(v[1] - w[1]); }
    function dot(a, b) { return a[0]*b[0] + a[1]*b[1]; }
    let A = [ax, ay], B = [bx, by], C = [cx, cy], D = [dx, dy];
    let u = [B[0] - A[0], B[1] - A[1]];
    let v = [D[0] - C[0], D[1] - C[1]];
    let w0 = [A[0] - C[0], A[1] - C[1]];
    let a = dot(u, u);
    let b = dot(u, v);
    let c = dot(v, v);
    let d = dot(u, w0);
    let e = dot(v, w0);
    let Dd = a * c - b * b;
    let sc, sN, sD = Dd;
    let tc, tN, tD = Dd;
    if (Dd < 1e-8) {
        sN = 0.0; sD = 1.0; tN = e; tD = c;
    } else {
        sN = (b * e - c * d);
        tN = (a * e - b * d);
        if (sN < 0) { sN = 0; tN = e; tD = c; }
        else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
    }
    if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
    else if (tN > tD) { tN = tD; if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; } }
    sc = Math.abs(sN) < 1e-8 ? 0.0 : sN / sD;
    tc = Math.abs(tN) < 1e-8 ? 0.0 : tN / tD;
    let dp = [w0[0] + sc * u[0] - tc * v[0], w0[1] + sc * u[1] - tc * v[1]];
    return Math.sqrt(dot(dp, dp));
}

function resolvePoleCollisions() {
    for (let id in others) {
        let o = others[id];
        if (!o.state) continue;
        let minDist = segmentDistance(
            mouse.x, mouse.y, pole.x, pole.y,
            o.state.mouse.x, o.state.mouse.y, o.state.pole.x, o.state.pole.y
        );
        let minAllowed = poleWidth * 1.2;
        if (minDist < minAllowed) {
            function closestPoints(ax, ay, bx, by, cx, cy, dx, dy) {
                function dot(a, b) { return a[0]*b[0] + a[1]*b[1]; }
                let A = [ax, ay], B = [bx, by], C = [cx, cy], D = [dx, dy];
                let u = [B[0] - A[0], B[1] - A[1]];
                let v = [D[0] - C[0], D[1] - C[1]];
                let w0 = [A[0] - C[0], A[1] - C[1]];
                let a = dot(u, u);
                let b = dot(u, v);
                let c = dot(v, v);
                let d = dot(u, w0);
                let e = dot(v, w0);
                let Dd = a * c - b * b;
                let sc, sN, sD = Dd;
                let tc, tN, tD = Dd;
                if (Dd < 1e-8) {
                    sN = 0.0; sD = 1.0; tN = e; tD = c;
                } else {
                    sN = (b * e - c * d);
                    tN = (a * e - b * d);
                    if (sN < 0) { sN = 0; tN = e; tD = c; }
                    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
                }
                if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
                else if (tN > tD) { tN = tD; if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; } }
                sc = Math.abs(sN) < 1e-8 ? 0.0 : sN / sD;
                tc = Math.abs(tN) < 1e-8 ? 0.0 : tN / tD;
                let pA = [A[0] + sc * u[0], A[1] + sc * u[1]];
                let pB = [C[0] + tc * v[0], C[1] + tc * v[1]];
                return [pA[0], pA[1], pB[0], pB[1], sc, tc];
            }
            let [p1x, p1y, p2x, p2y, sc, tc] = closestPoints(
                mouse.x, mouse.y, pole.x, pole.y,
                o.state.mouse.x, o.state.mouse.y, o.state.pole.x, o.state.pole.y
            );
            let dx = p1x - p2x;
            let dy = p1y - p2y;
            let d = Math.sqrt(dx*dx + dy*dy) || 1;
            let correction = (minAllowed - d);
            if (correction > 0) {
                // Calculate relative velocity at collision point
                let myVx = pole.vx * sc;
                let myVy = pole.vy * sc;
                let otherVx = (o.state.pole.vx || 0) * tc;
                let otherVy = (o.state.pole.vy || 0) * tc;
                let relVx = myVx - otherVx;
                let relVy = myVy - otherVy;
                let relVelAlongNormal = (relVx * dx + relVy * dy) / d;
                // Only resolve if moving toward each other
                if (relVelAlongNormal < 0) {
                    // Impulse magnitude (elastic collision, equal mass)
                    let impulse = -(1.0 + 0.8) * relVelAlongNormal / 2;
                    let ix = (dx/d) * impulse;
                    let iy = (dy/d) * impulse;
                    pole.vx += ix;
                    pole.vy += iy;
                }
                // Move our pole's free end so the segments are separated by minAllowed
                let fx = (dx/d) * correction;
                let fy = (dy/d) * correction;
                pole.x += fx;
                pole.y += fy;
                // After moving, re-enforce the pole length constraint
                let pdx = pole.x - mouse.x;
                let pdy = pole.y - mouse.y;
                let plen = Math.sqrt(pdx*pdx + pdy*pdy);
                if (plen !== 0) {
                    let diff = (plen - poleLength) / plen;
                    pole.x -= pdx * diff;
                    pole.y -= pdy * diff;
                    pole.vx -= pdx * diff;
                    pole.vy -= pdy * diff;
                }
            }
        }
    }
}

function update() {
    // Apply gravity to free end
    pole.vy += gravity;

    // Update position
    pole.x += pole.vx;
    pole.y += pole.vy;

    // Constrain pole length (keep one end at mouse)
    let dx = pole.x - mouse.x;
    let dy = pole.y - mouse.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist !== 0) {
        let diff = (dist - poleLength) / dist;
        pole.x -= dx * diff;
        pole.y -= dy * diff;
        // Adjust velocity to match constraint
        pole.vx -= dx * diff;
        pole.vy -= dy * diff;
    }

    // Damping
    pole.vx *= damping;
    pole.vy *= damping;

    resolvePoleCollisions();
    sendState();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw others' poles
    for (let id in others) {
        let o = others[id];
        if (!o.state) continue;
        ctx.save();
        ctx.strokeStyle = o.color;
        ctx.lineWidth = poleWidth;
        ctx.beginPath();
        ctx.moveTo(o.state.mouse.x, o.state.mouse.y);
        ctx.lineTo(o.state.pole.x, o.state.pole.y);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(o.state.mouse.x, o.state.mouse.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(o.state.pole.x, o.state.pole.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Draw my pole
    ctx.save();
    ctx.strokeStyle = myColor;
    ctx.lineWidth = poleWidth;
    ctx.beginPath();
    ctx.moveTo(mouse.x, mouse.y);
    ctx.lineTo(pole.x, pole.y);
    ctx.stroke();
    ctx.restore();

    // Draw joints
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pole.x, pole.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

loop();
