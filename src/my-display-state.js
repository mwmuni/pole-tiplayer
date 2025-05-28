// src/my-display-state.js
export function createDisplayState(frame, playersData) { // playersData from MyWorld
    return {
        frame: frame,
        players: playersData, // Map<anetId, PlayerPoleState>
    };
}

export function interpolate(prevState, nextState, t) {
    const interpolatedPlayers = new Map();
    
    // Iterate over players in nextState, assuming they might also be in prevState
    for (const [anetId, nextPlayer] of nextState.players.entries()) {
        const prevPlayer = prevState.players.get(anetId);
        if (prevPlayer) {
            interpolatedPlayers.set(anetId, {
                anetId: nextPlayer.anetId,
                color: nextPlayer.color, // Color usually doesn't change or interpolate
                mouseX: (1 - t) * prevPlayer.mouseX + t * nextPlayer.mouseX,
                mouseY: (1 - t) * prevPlayer.mouseY + t * nextPlayer.mouseY,
                poleX: (1 - t) * prevPlayer.poleX + t * nextPlayer.poleX,
                poleY: (1 - t) * prevPlayer.poleY + t * nextPlayer.poleY,
                poleVX: (1 - t) * prevPlayer.poleVX + t * nextPlayer.poleVX, // Velocities can also be interpolated
                poleVY: (1 - t) * prevPlayer.poleVY + t * nextPlayer.poleVY,
            });
        } else {
            // Player is new in nextState, just use their state
            // For smoother appearance of new players, could fade in or use a default start if needed
            interpolatedPlayers.set(anetId, { ...nextPlayer });
        }
    }
    return { frame: nextState.frame, players: interpolatedPlayers };
}
