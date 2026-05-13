const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;

// Game State
let players = {};
let gameState = {
    items: {}, // Synced locations of items like pliers, hammer, etc.
    doors: {}, // Synced state of doors
    grannyPos: { x: 0, y: 0, z: 0 },
    grannyTarget: null
};

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull');
        socket.disconnect();
        return;
    }

    console.log('User connected:', socket.id);
    players[socket.id] = {
        id: socket.id,
        pos: { x: 0, y: 0, z: 0 },
        rot: { y: 0 },
        username: 'Guest-' + Math.floor(Math.random() * 9000000 + 1000000),
        lives: 5
    };

    // Send current state to new player
    socket.emit('init', { id: socket.id, players, gameState });

    // Broadcast new player to others
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Handle Movement Sync
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].pos = data.pos;
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, pos: data.pos, rot: data.rot });
        }
    });

    // Handle Item Interaction Sync
    socket.on('itemAction', (data) => {
        // data = { itemId: 'hammer', action: 'pickup' or 'drop', pos: ... }
        gameState.items[data.itemId] = data;
        io.emit('itemUpdate', data);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Tung Tung Sahorror running on port ${PORT}`);
});
