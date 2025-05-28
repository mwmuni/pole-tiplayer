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
let ws;

function connectWS() {
    // For Cloudflare deployment, always use wss when served over https
    // Cloudflare will handle the SSL termination and proxy to your backend
    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    
    console.log(`Attempting WebSocket connection: ${wsProtocol}://${location.host}/ws/`);
    
    // Try primary connection
    ws = new WebSocket(`${wsProtocol}://${location.host}/ws/`);
    
    ws.onopen = () => {
        console.log('WebSocket connected successfully');
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // If wss fails and we're on https, this might be a Cloudflare configuration issue
        if (wsProtocol === 'wss') {
            console.error('WSS connection failed. Possible causes:');
            console.error('1. Cloudflare WebSockets not enabled');
            console.error('2. Server not configured for HTTPS (use "Flexible" SSL mode)');
            console.error('3. Backend server not running or not accessible');
        }
    };
    
    ws.onmessage = e => {
        let data = JSON.parse(e.data);
        if (data.type === 'init') {
            myId = data.id;
            myColor = data.color;
        } else if (data.type === 'states') {
            others = {};
            for (let c of data.all) {
                if (c.id !== myId) others[c.id] = c;
            }
        }
    };
    
    ws.onclose = (event) => {
        console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
        console.log('Reconnecting in 2 seconds...');
        setTimeout(connectWS, 2000);
    };
}
connectWS();

function sendState() {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'state', state: {
            mouse, pole
        }}));
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
