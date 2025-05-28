// src/my-snapshot.js
// PlayerPoleState structure will be shared with MyDisplayState via MyWorld
export function createSnapshot(frame, playersData) { // playersData is a Map or object
    return {
        frame: frame,
        players: playersData, // e.g., Map<anetId, PlayerPoleState>
    };
}
