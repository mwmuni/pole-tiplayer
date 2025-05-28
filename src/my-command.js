// src/my-command.js
// import { Command } from '@hastearcade/snowglobe'; // If using class extension

// Command type
export const CommandType = {
    MOUSE_MOVE: 'mouse_move',
};

// Function to create a mouse move command
// Snowglobe's issueCommand will send this to the server.
// The server's applyCommand will receive this and the anetId of the sender.
export function createMouseMoveCommand(x, y) {
    return {
        type: CommandType.MOUSE_MOVE,
        x: x,
        y: y,
        // Required by Snowglobe's Command interface if not extending a base class that has it
        clone() { return { ...this }; } 
    };
}

// Old placeholder - remove or comment out
// export { createCommand /*, MoveCommand, MyBaseCommand */ };
