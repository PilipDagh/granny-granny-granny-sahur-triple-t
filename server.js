const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- GLOBAL GAME STATE ---
let players = {};
let gameState = {
    items: {
        'hammer': { pos: {x: 15, y: -3.5, z: -25}, holder: null, visible: true },
        'pliers': { pos: {x: 12, y: 0.5, z: 5}, holder: null, visible: true },
        'master_key': { pos: {x: 0, y: 4.5, z: 0}, holder: null, visible: true }
    },
    puzzles: {
        'barricade': { solved: false },
        'circuitBox': { solved: false },
        'mainDoor': { solved: false }
    },
    grannyTarget: null
};

io.on('connection', (socket) => {
    // Enforce 50-player limit
    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull', 'The public server is currently full (50/50).');
        socket.disconnect();
        return;
    }

    console.log('Player connected:', socket.id);

    // Initialize new player
    players[socket.id] = {
        id: socket.id,
        username: 'Guest-' + Math.floor(Math.random() * 9000000 + 1000000),
        pos: { x: 0, y: 1.7, z: 0 },
        rot: 0,
        lives: 5,
        isDead: false
    };

    // Send the current world state to the new player
    socket.emit('init', { id: socket.id, players, gameState });

    // Tell everyone else a new player joined
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Handle Username Setting
    socket.on('setUsername', (name) => {
        if (name && name.trim().length > 0) {
            players[socket.id].username = name.trim();
            io.emit('usernameUpdated', { id: socket.id, username: players[socket.id].username });
        }
    });

    // Sync Movement
    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].pos = data.pos;
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, pos: data.pos, rot: data.rot });
        }
    });
    // --- ADD THESE TO server.js INSIDE io.on('connection') ---
    
    // Sync Hiding Status
    socket.on('setHiding', (isHiding) => {
        if (players[socket.id]) {
            players[socket.id].isHiding = isHiding;
            socket.broadcast.emit('playerHiding', { id: socket.id, isHiding: isHiding });
        }
    });

    // Sync Noise Distractions
    socket.on('makeNoise', (pos) => {
        io.emit('noiseMade', pos); // Tell ALL players that a noise happened here
    });

    // CHANGE THE HAMMER SPAWN LOCATION TO THE BASEMENT
    // Find gameState.items in server.js and change the hammer's pos to:
    // 

    // Sync Item Pickups / Drops
    socket.on('itemAction', (data) => {
        const item = gameState.items[data.itemId];
        if (item) {
            if (data.action === 'pickup') {
                item.holder = socket.id;
                item.visible = false;
            } else if (data.action === 'drop') {
                item.holder = null;
                item.visible = true;
                item.pos = data.pos; // Drop at player's current location
            }
            io.emit('itemUpdate', { itemId: data.itemId, itemState: item });
        }
    });

    // Sync Puzzle Solving
    socket.on('puzzleSolved', (data) => {
        if (gameState.puzzles[data.obstacleId]) {
            gameState.puzzles[data.obstacleId].solved = true;
            io.emit('puzzleUpdate', { obstacleId: data.obstacleId });
            
            // If main door is solved, trigger server-wide escape/reset
            if (data.obstacleId === 'mainDoor') {
                io.emit('gameWon', players[socket.id].username);
                resetServerState();
            }
        }
    });

    // Handle Player Death
    socket.on('playerDied', () => {
        if (players[socket.id]) {
            players[socket.id].lives -= 1;
            if (players[socket.id].lives <= 0) {
                players[socket.id].isDead = true;
                socket.broadcast.emit('playerEliminated', socket.id);
                
                // Check if ALL players are dead
                const allDead = Object.values(players).every(p => p.isDead);
                if (allDead) {
                    io.emit('gameOverAll');
                    resetServerState();
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        // Drop any item they were holding
        for (const [key, item] of Object.entries(gameState.items)) {
            if (item.holder === socket.id) {
                item.holder = null;
                item.visible = true;
                io.emit('itemUpdate', { itemId: key, itemState: item });
            }
        }
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

function resetServerState() {
    // Reset puzzles and items after a win or total loss
    Object.keys(gameState.puzzles).forEach(k => gameState.puzzles[k].solved = false);
    Object.keys(gameState.items).forEach(k => {
        gameState.items[k].holder = null;
        gameState.items[k].visible = true;
    });
    // Reset player lives
    Object.keys(players).forEach(k => {
        players[k].lives = 5;
        players[k].isDead = false;
    });
    io.emit('serverReset', gameState);
}

// Catch-all route to prevent "Cannot GET /"
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Tung Tung Sahorror Server cooking on port ${PORT}`);
});
