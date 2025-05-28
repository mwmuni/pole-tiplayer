// Assuming Snowglobe and your src files are bundled or accessible as modules
// If not, these might need to be global or accessed differently.
// For now, let's assume a module environment for clarity.
// import { Client as SnowglobeClient, makeConfig } from '@hastearcade/snowglobe'; // Or from where snowglobe is accessible
// import { MyWorld } from './src/my-world.js';
// import { Net } from './src/net-resource.js';
// import { createCommand } from './src/my-command.js';
// import { interpolate } from './src/my-display-state.js'; // Assuming interpolate is exported here

// Assuming Snowglobe and your src files are bundled or accessible as modules.
// These would be actual imports in a module system:
// import { Client as SnowglobeClient, makeConfig } from '@hastearcade/snowglobe';
// import { MyWorld, POLE_LENGTH, POLE_WIDTH, GRAVITY, DAMPING } from './src/my-world.js'; // POLE_WIDTH needed for draw
// import { Net } from './src/net-resource.js';
// import { createMouseMoveCommand, CommandType } from './src/my-command.js';
// import { interpolate } from './src/my-display-state.js';

// For the tool environment, assume these are available if not explicitly imported by path.
// We'll use them as if they are: SnowglobeClient, makeConfig, MyWorld, Net, 
// createMouseMoveCommand, CommandType, interpolate, POLE_WIDTH.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Resize canvas to fill window
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Pole parameters from MyWorld (e.g. MyWorld.POLE_WIDTH) are used implicitly by MyWorld instance.
// Client-side game.js no longer needs to define them if drawing relies on displayState.
// const poleLength = 200; // Defined in MyWorld
// const poleWidth = 8;    // Defined in MyWorld (as POLE_WIDTH)
// const gravity = 0.5;    // Defined in MyWorld
// const damping = 0.995;  // Defined in MyWorld

// Local mouse state for direct input sending
let localMouse = { x: canvas.width / 2, y: canvas.height / 2 };

// Old global state variables for local player's pole and other players are removed.
// Data will now come from snowglobeClient.displayState().
// let pole = { ... }; // Removed
// let others = {}; // Removed

// Mouse tracking
canvas.addEventListener('mousemove', e => {
    localMouse.x = e.clientX;
    localMouse.y = e.clientY;
    if (snowglobeClient && localPlayerAnetId !== null && netClient) {
        // Assumes createMouseMoveCommand is available (e.g. imported or global)
        const command = createMouseMoveCommand(localMouse.x, localMouse.y); 
        snowglobeClient.issueCommand(command, netClient);
    }
});

// let myId = null; // Replaced by localPlayerAnetId
let clientColor = '#FFD700'; // Default, updated by server via init_client

// Snowglobe related variables
let snowglobeClient; // Will be SnowglobeClient instance
let netClient;       // Will be Net class instance
let localPlayerAnetId = null;

// sgConfig can be null for Snowglobe defaults.
// const sgConfig = makeConfig(); // If needed: import makeConfig from '@hastearcade/snowglobe'
const sgConfig = null; 

let interpolateFnLocal; // Renamed to avoid conflict if 'interpolate' is a global/import

// Client-side prediction and rollback related variables are managed by Snowglobe.
// const STATE_HISTORY_SIZE = 120; 
// let stateHistory = []; 
// let confirmedStates = new Map(); 
// let inputHistory = []; 
// let currentFrame = 0;
// let lastConfirmedFrame = 0;

// Data usage tracking (can be kept if needed, but Snowglobe doesn't use it)
// let totalBytesSent = 0;
// let totalMessagesSent = 0;
// let lastStatsTime = Date.now(); 

function initializeSnowglobe() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        
        // Instantiate Net class (assuming it's available globally or imported from ./src/index.js)
        netClient = new Net(ws, false); 
        
        // Assign interpolate function (assuming it's available globally or imported from ./src/index.js)
        interpolateFnLocal = interpolate; 

        // ws.onmessage is now primarily handled by the Net instance for Snowglobe.
        // However, the initial `init_client` is a custom message this app uses *before*
        // Snowglobe takes over message processing via netClient.receive().
        ws.onmessage = (event) => { 
            try {
                const parsedMessage = JSON.parse(event.data);
                
                if (parsedMessage.type === 'init_client') {
                    localPlayerAnetId = parsedMessage.anetId;
                    clientColor = parsedMessage.color;
                    console.log(`Client initialized by server. AnetID: ${localPlayerAnetId}, Color: ${clientColor}`);
                    
                    if (!snowglobeClient) {
                        // Instantiate SnowglobeClient (assuming it's available globally or imported)
                        // Also MyWorld (globally or imported)
                        snowglobeClient = new SnowglobeClient(
                            () => new MyWorld(() => localPlayerAnetId), 
                            sgConfig, 
                            interpolateFnLocal, 
                            0, // serverAnetId
                            localPlayerAnetId 
                        );
                        console.log('Snowglobe Client fully initialized.');
                    }
                } else {
                    // Other messages are for Snowglobe's Net instance to process via its receive queue
                    if (netClient && netClient.messageQueue && typeof netClient.messageQueue.push === 'function') {
                         netClient.messageQueue.push({ data: parsedMessage }); // Snowglobe expects {data: actualMsg}
                    } else {
                         console.warn("NetClient or its messageQueue not ready for message: ", parsedMessage);
                    }
                }
            } catch (e) {
                console.error('Error processing message from server:', e);
            }
        };
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Attempting to reconnect...');
        snowglobeClient = null; 
        netClient = null; 
        setTimeout(initializeSnowglobe, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // ws.close(); // Optional: ensure close is called to trigger reconnect logic
    };
}

initializeSnowglobe(); // Start connection

// roundValue and other utility functions specific to old local physics/state are removed.

// Old local physics update function is removed.
// function update() { ... } 
// Old collision functions are removed as they are now in MyWorld.
// function resolvePoleCollisions() { ... }
// function segmentDistance() { ... }

function draw(displayState) { 
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!displayState || !displayState.players) return;

    for (const [anetId, player] of displayState.players.entries()) {
        ctx.save();
        // Use POLE_WIDTH from MyWorld if available (e.g. import {POLE_WIDTH} from './src/my-world.js')
        // For now, using a hardcoded default or assuming it's globally available.
        const poleDrawWidth = (typeof POLE_WIDTH !== 'undefined') ? POLE_WIDTH : 8; 
        ctx.strokeStyle = player.color || (anetId === localPlayerAnetId ? clientColor : '#CCCCCC');
        ctx.lineWidth = poleDrawWidth;
        ctx.beginPath();
        ctx.moveTo(player.mouseX, player.mouseY);
        ctx.lineTo(player.poleX, player.poleY);
        ctx.stroke();
        
        ctx.fillStyle = '#fff'; // Joint color
        ctx.beginPath();
        ctx.arc(player.mouseX, player.mouseY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(player.poleX, player.poleY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

const GAME_TICK_RATE = 60; // Hz
const TICK_INTERVAL_MS = 1000 / GAME_TICK_RATE;
let lastTickTime = Date.now();

function loop() {
    const now = Date.now();
    const deltaSeconds = (now - lastTickTime) / 1000;
    lastTickTime = now;

    if (snowglobeClient && netClient) {
        snowglobeClient.update(deltaSeconds, now / 1000, netClient);
        const currentDisplayState = snowglobeClient.displayState();
        if (currentDisplayState) {
            draw(currentDisplayState);
        }
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "16px Arial";
        ctx.fillStyle = "white";
        ctx.fillText("Connecting to server and initializing Snowglobe...", 20, 40);
    }
    
    requestAnimationFrame(loop);
}

loop();
// Note: Global constants like POLE_WIDTH used in draw() would ideally be imported 
// from my-world.js or passed within displayState if they can vary.
