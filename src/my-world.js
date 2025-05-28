// src/my-world.js
// import { World } from '@hastearcade/snowglobe'; // If using class extension
import { CommandType } from './my-command.js'; // Assuming this path
import { createSnapshot } from './my-snapshot.js';
import { createDisplayState } from './my-display-state.js';

const POLE_LENGTH = 200;
const POLE_WIDTH = 8; // Used for collision visualization, actual collision handled by distance
const GRAVITY = 0.5;
const DAMPING = 0.995;

class MyWorld /* extends World */ {
    constructor(getLocalAnetIdFn) {
        // getLocalAnetIdFn is a function that returns the anetId of the local player on the client,
        // or null/undefined on the server if not applicable in this context.
        this.getLocalAnetId = getLocalAnetIdFn || (() => null);
        this.players = new Map(); // anetId -> PlayerPoleState
                                // PlayerPoleState: { anetId, color, mouseX, mouseY, poleX, poleY, poleVX, poleVY }
        this.frame = 0;
    }

    // Helper to add or get a player
    _getPlayer(anetId, color = `hsl(${Math.floor(Math.random()*360)}, 80%, 60%)`) {
        if (!this.players.has(anetId)) {
            this.players.set(anetId, {
                anetId: anetId,
                color: color, // Use provided color or default from signature
                mouseX: 0, // Initialize position
                mouseY: 0,
                poleX: POLE_LENGTH, // Initial pole position relative to mouse
                poleY: 0,
                poleVX: 0,
                poleVY: 0,
            });
        }
        const player = this.players.get(anetId);
        if (color && player.color !== color) { // Update color if a new one is provided (e.g. server init)
            player.color = color;
        }
        return player;
    }

    commandIsValid(command, anetId, frame) {
        // Basic validation: only MOUSE_MOVE is valid for now
        return command && command.type === CommandType.MOUSE_MOVE &&
               typeof command.x === 'number' && typeof command.y === 'number';
    }

    applyCommand(command, anetId, frame) {
        if (!this.commandIsValid(command, anetId, frame)) {
            return;
        }
        // On the server, the player's color would have been set when they connected (via NetResource).
        // On the client, the anetId for its own commands is its localPlayerAnetId,
        // and its color is known. For other players' commands (if client predicts),
        // their state (including color) should already exist from snapshots.
        const player = this._getPlayer(anetId); 
        if (command.type === CommandType.MOUSE_MOVE) {
            player.mouseX = command.x;
            player.mouseY = command.y;
        }
    }

    step(deltaSeconds) {
        this.frame++;
        // Update each player's pole physics
        for (const [anetId, player] of this.players.entries()) {
            // Scale physics calculations by deltaSeconds, assuming constants are tuned for 60 FPS
            const timeScale = deltaSeconds * 60;
            player.poleVY += GRAVITY * timeScale;
            player.poleX += player.poleVX * timeScale;
            player.poleY += player.poleVY * timeScale;

            let dx = player.poleX - player.mouseX;
            let dy = player.poleY - player.mouseY;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist !== 0) {
                let diff = (dist - POLE_LENGTH) / dist;
                player.poleX -= dx * diff;
                player.poleY -= dy * diff;
                // Adjust velocity to match constraint (simplified)
                player.poleVX -= dx * diff; // This is a simplification; true constrained dynamics are more complex
                player.poleVY -= dy * diff;
            }
            // Apply damping; for variable timesteps, Math.pow(DAMPING, timeScale) is more accurate
            // but for small deltaSeconds, direct multiplication is often fine.
            // Using Math.pow for better accuracy with variable deltaSeconds:
            const effectiveDamping = Math.pow(DAMPING, timeScale);
            player.poleVX *= effectiveDamping;
            player.poleVY *= effectiveDamping;
        }
        this._resolveAllCollisions();
    }
    
    _resolveAllCollisions() {
        const playerList = Array.from(this.players.values());
        for (let i = 0; i < playerList.length; i++) {
            for (let j = i + 1; j < playerList.length; j++) {
                this._resolveCollisionBetweenTwoPoles(playerList[i], playerList[j]);
            }
        }
    }

   _segmentDistance(p1mX, p1mY, p1pX, p1pY, p2mX, p2mY, p2pX, p2pY) {
        function sqr(x) { return x * x; }
        // dist2 removed as it's not used directly here
        function dot(a, b) { return a[0]*b[0] + a[1]*b[1]; }
        let A = [p1mX, p1mY], B = [p1pX, p1pY], C = [p2mX, p2mY], D = [p2pX, p2pY];
        let u = [B[0] - A[0], B[1] - A[1]];
        let v = [D[0] - C[0], D[1] - C[1]];
        let w0 = [A[0] - C[0], A[1] - C[1]];
        let a = dot(u,u); let b = dot(u,v); let c = dot(v,v);
        let d = dot(u,w0); let e = dot(v,w0);
        let Dd = a*c - b*b;
        let sc, sN, sD = Dd; let tc, tN, tD = Dd;
        if (Dd < 1e-8) { sN = 0; sD = 1; tN = e; tD = c; }
        else { sN = (b*e - c*d); tN = (a*e - b*d);
            if (sN < 0) { sN = 0; tN = e; tD = c; }
            else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
        }
        if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
        else if (tN > tD) { tN = tD; if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; } }
        sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
        tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
        let dp = [w0[0] + sc*u[0] - tc*v[0], w0[1] + sc*u[1] - tc*v[1]];
        return Math.sqrt(dot(dp,dp));
   }
   
    _closestPointsOnSegments(p1mX, p1mY, p1pX, p1pY, p2mX, p2mY, p2pX, p2pY) {
        function dot(a, b) { return a[0]*b[0] + a[1]*b[1]; }
        let A = [p1mX, p1mY], B = [p1pX, p1pY], C = [p2mX, p2mY], D = [p2pX, p2pY];
        let u = [B[0] - A[0], B[1] - A[1]];
        let v = [D[0] - C[0], D[1] - C[1]];
        let w0 = [A[0] - C[0], A[1] - C[1]];
        let a = dot(u,u); let b = dot(u,v); let c = dot(v,v);
        let d = dot(u,w0); let e = dot(v,w0);
        let Dd = a*c - b*b;
        let sc, sN, sD = Dd; let tc, tN, tD = Dd;
        if (Dd < 1e-8) { sN = 0; sD = 1; tN = e; tD = c; }
        else { sN = (b*e - c*d); tN = (a*e - b*d);
            if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
        }
        if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
        else if (tN > tD) { tN = tD; if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; } }
        sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
        tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
        return [A[0] + sc*u[0], A[1] + sc*u[1], C[0] + tc*v[0], C[1] + tc*v[1], sc, tc];
    }

   _resolveCollisionBetweenTwoPoles(player1, player2) {
       const minDist = POLE_WIDTH * 1.2; 
       const dist = this._segmentDistance(
           player1.mouseX, player1.mouseY, player1.poleX, player1.poleY,
           player2.mouseX, player2.mouseY, player2.poleX, player2.poleY
       );

       if (dist < minDist) {
           const [p1ClosestX, p1ClosestY, p2ClosestX, p2ClosestY, sc1, sc2] = this._closestPointsOnSegments(
               player1.mouseX, player1.mouseY, player1.poleX, player1.poleY,
               player2.mouseX, player2.mouseY, player2.poleX, player2.poleY
           );

           let dx = p1ClosestX - p2ClosestX;
           let dy = p1ClosestY - p2ClosestY;
           let d = Math.sqrt(dx*dx + dy*dy) || 1; // Avoid division by zero if points are identical
           let correction = (minDist - d) / 2.0; // Each player corrects half

           if (correction > 0) {
               // Simplified: just push them apart. Full impulse physics is complex here.
               // Positional correction applied based on the closest point's influence (sc1, sc2)
               // We only apply positional correction to the free ends of the poles.
               // Calculate how much of the correction applies to the free end based on 'sc' parameter
               
               const p1CorrectionFactor = sc1; // How much player1's free end is involved
               const p2CorrectionFactor = sc2; // How much player2's free end is involved

               player1.poleX += (dx / d) * correction * p1CorrectionFactor;
               player1.poleY += (dy / d) * correction * p1CorrectionFactor;
               player2.poleX -= (dx / d) * correction * p2CorrectionFactor;
               player2.poleY -= (dy / d) * correction * p2CorrectionFactor;
               
               // Re-enforce pole length for player1
               let pdx1 = player1.poleX - player1.mouseX;
               let pdy1 = player1.poleY - player1.mouseY;
               let plen1 = Math.sqrt(pdx1*pdx1 + pdy1*pdy1);
               if (plen1 !== 0 && plen1 !== POLE_LENGTH) { // Avoid division by zero and unnecessary ops
                   let diff1 = (plen1 - POLE_LENGTH) / plen1;
                   player1.poleX -= pdx1 * diff1;
                   player1.poleY -= pdy1 * diff1;
                   // Note: Not adjusting velocity here for simplicity in this step
               }

               // Re-enforce pole length for player2
               let pdx2 = player2.poleX - player2.mouseX;
               let pdy2 = player2.poleY - player2.mouseY;
               let plen2 = Math.sqrt(pdx2*pdx2 + pdy2*pdy2);
               if (plen2 !== 0 && plen2 !== POLE_LENGTH) { // Avoid division by zero and unnecessary ops
                   let diff2 = (plen2 - POLE_LENGTH) / plen2;
                   player2.poleX -= pdx2 * diff2;
                   player2.poleY -= pdy2 * diff2;
               }
           }
       }
   }

   snapshot(currentFrame) { // Snowglobe server calls this
       const playersClone = new Map();
       for (const [anetId, playerData] of this.players.entries()) {
           playersClone.set(anetId, { ...playerData });
       }
       return createSnapshot(currentFrame ?? this.frame, playersClone);
   }

   applySnapshot(snapshot, frame) { // Snowglobe client calls this
       this.frame = snapshot.frame;
       this.players.clear();
       for (const [anetId, playerData] of snapshot.players.entries()) {
           // It's good practice to ensure data types are as expected, e.g., converting to Number
           this.players.set(anetId, { 
                ...playerData,
                mouseX: Number(playerData.mouseX) || 0,
                mouseY: Number(playerData.mouseY) || 0,
                poleX: Number(playerData.poleX) || 0,
                poleY: Number(playerData.poleY) || 0,
                poleVX: Number(playerData.poleVX) || 0,
                poleVY: Number(playerData.poleVY) || 0,
            });
           // If we are client and this anetId is our local player, ensure local mouse matches
           // if (this.getLocalAnetId && anetId === this.getLocalAnetId()) {
               // This might be needed if server authoritative mouse is desired.
               // For now, client mouse input is king for its own player.
           // }
       }
   }

   displayState(frame) { // Snowglobe client calls this
       // For this game, display state is the same as the world state (all players)
       // Deep clone for safety, though interpolation should handle this.
       const playersClone = new Map();
       for (const [anetId, playerData] of this.players.entries()) {
           playersClone.set(anetId, { ...playerData });
       }
       return createDisplayState(frame ?? this.frame, playersClone);
   }
}
export { MyWorld, POLE_LENGTH, POLE_WIDTH, GRAVITY, DAMPING };
