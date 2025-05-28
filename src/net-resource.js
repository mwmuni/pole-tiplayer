// src/net-resource.js
// import { NetworkResource } from '@hastearcade/snowglobe'; // We'll uncomment and use this later

const MESSAGE_TYPE = {
    SNAPSHOT: 'snapshot',
    COMMAND: 'command',
    // Add other message types as needed, e.g., for initial connection
};

class Net /* extends NetworkResource */ {
    constructor(ws, isServer = false) {
        this.ws = ws; // WebSocket client instance or ws.Server instance
        this.isServer = isServer;
        this.messageQueue = []; // To store incoming messages for Snowglobe
        this.clients = new Map(); // Server-side: store anetId -> WebSocket client
        this.nextAnetId = 1; // Server-side: to assign unique anetIds

        if (this.isServer) {
            this.ws.on('connection', (clientSocket) => {
                const anetId = this.nextAnetId++;
                this.clients.set(anetId, clientSocket);
                console.log(`NetResource: Client connected, assigned anetId ${anetId}`);

                // Send an initialization message to the client with its anetId and a color
                const clientInitMessage = {
                    type: 'init_client', // Matches what game.js expects
                    anetId: anetId,
                    color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)` // Assign a random color
                };
                try {
                    clientSocket.send(JSON.stringify(clientInitMessage));
                } catch (e) {
                    console.error(`NetResource: Failed to send init_client message to ${anetId}`, e);
                    // Consider cleanup if send fails immediately
                    this.clients.delete(anetId);
                    clientSocket.terminate(); // Or close()
                }

                clientSocket.on('message', (message) => {
                    try {
                        const parsedMessage = JSON.parse(message);
                        // Enqueue with anetId for server-side processing
                        this.messageQueue.push({ anetId, data: parsedMessage });
                    } catch (e) {
                        console.error('NetResource: Error parsing incoming message:', e);
                    }
                });

                clientSocket.on('close', () => {
                    this.clients.delete(anetId);
                    // Optionally, enqueue a disconnect event for Snowglobe if needed
                    // this.messageQueue.push({ type: 'disconnect', anetId });
                    console.log(`NetResource: Client ${anetId} disconnected`);
                });

                clientSocket.on('error', (error) => {
                    console.error(`NetResource: Error on client ${anetId}:`, error);
                    // Handle error, maybe clean up client
                    this.clients.delete(anetId);
                });
            });
        } else {
            // Client-side WebSocket message handling
            this.ws.onmessage = (event) => {
                try {
                    const parsedMessage = JSON.parse(event.data);
                    // Client-side messages don't strictly need anetId from Snowglobe's perspective for queueing,
                    // as they are from the server. Snowglobe client anetId is usually 0 for the server.
                    this.messageQueue.push({ data: parsedMessage });
                } catch (e) {
                    console.error('NetResource: Error parsing incoming message:', e);
                }
            };
            this.ws.onerror = (event) => {
                console.error('NetResource: WebSocket error:', event);
            };
            this.ws.onclose = (event) => {
                console.log('NetResource: WebSocket connection closed:', event);
                // Optionally, enqueue a disconnect event for Snowglobe
            };
        }
    }

    // Required by Snowglobe's NetworkResource interface (anet.send)
    // anetIdOrReliable: boolean (reliable) or number (anetId for server->client direct message)
    // anetIdOrData: number (anetId for client->server or server->specific_client) or any (data if reliable is first arg)
    // dataOrUndefined: any (data if anetId is second arg) or undefined
    send(anetIdOrReliable, anetIdOrData, dataOrUndefined) {
        let targetSocket;
        let data;
        let reliable = true; // Assuming reliable for now, Snowglobe will specify

        if (this.isServer) {
            if (typeof anetIdOrReliable === 'number') { // Direct message to a client
                targetSocket = this.clients.get(anetIdOrReliable);
                data = anetIdOrData; // In this case, anetIdOrData is the actual data
                                     // reliable is implicitly true for server->client direct message in this interpretation
            } else {
                // This case (reliable, data) for server is typically for broadcast or server messages not tied to a specific client response.
                // Snowglobe's server usually sends snapshots to all clients, handled by iterating `this.connections()`.
                // For now, we'll assume this specific signature implies a direct message if the first arg is an anetId.
                // If it's a boolean (reliable), then it's likely a command from server to a specific client (anetIdOrData).
                 if (typeof anetIdOrReliable === 'boolean') {
                    reliable = anetIdOrReliable;
                    const targetAnetId = anetIdOrData;
                    data = dataOrUndefined;
                    targetSocket = this.clients.get(targetAnetId);
                 } else {
                    console.error("NetResource Server: send() called with unexpected signature for server.", anetIdOrReliable, anetIdOrData);
                    return;
                 }
            }
        } else { // Client sending to server
            targetSocket = this.ws;
            // Client send: reliable, data (anetId is implicit, server is anetId 0 for client)
            // OR anetId (0), data (if Snowglobe client uses anetId 0 for server)
            if (typeof anetIdOrReliable === 'boolean') {
                 reliable = anetIdOrReliable; // Snowglobe usually passes true for reliable
                 data = anetIdOrData;
            } else if (anetIdOrReliable === 0) { // anetId 0 typically means the server for a client
                 data = anetIdOrData;
            } else {
                console.error("NetResource Client: send() called with unexpected signature for client.", anetIdOrReliable, anetIdOrData);
                return;
            }
        }

        if (targetSocket && targetSocket.readyState === 1 /* WebSocket.OPEN */) {
            try {
                // We'll need to wrap `data` with a type (e.g., COMMAND, SNAPSHOT)
                // For now, just sending what Snowglobe gives.
                // Actual data structure will depend on MyCommand and MySnapshot serialization.
                targetSocket.send(JSON.stringify(data));
            } catch (e) {
                console.error('NetResource: Error sending message:', e);
            }
        } else {
            // console.warn('NetResource: Target socket not ready or not found for anetId/data:', anetIdOrReliable, anetIdOrData);
        }
    }

    // Required by Snowglobe (anet.receive)
    // Snowglobe calls this in a loop within its update() method.
    receive() {
        return this.messageQueue.shift() || null; // Return one message at a time
    }

    // Required by Snowglobe (anet.connections) - Server-side primarily
    connections() {
        if (!this.isServer) {
            return []; // Clients typically don't manage multiple connections in this context
        }
        return Array.from(this.clients.keys()); // Return list of anetIds
    }
    
    // Utility to get a client socket by anetId (server-side)
    getClientSocket(anetId) {
        return this.clients.get(anetId);
    }
}

export { Net, MESSAGE_TYPE };
