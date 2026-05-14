const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let gameState = {
    items: {
        'hammer': { pos: {x: 15, y: -3.5, z: -25}, holder: null, visible: true },
        'pliers': { pos: {x: 12, y: 0.5, z: 5}, holder: null, visible: true },
        'master_key': { pos: {x: 0, y: 4.5, z: 0}, holder: null, visible: true },
        // NEW: Weapons Key and Crossbow
        'weapons_key': { pos: {x: -3, y: 0.5, z: 8}, holder: null, visible: true },
        'crossbow': { pos: {x: 22, y: 0.5, z: 8}, holder: null, visible: false } // Hidden in case initially
    },
    puzzles: {
        'barricade': { solved: false },
        'circuitBox': { solved: false },
        'mainDoor': { solved: false },
        'weaponsCase': { solved: false } // NEW: Weapons Case
    }
};

io.on('connection', (socket) => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull', 'Server is full.');
        socket.disconnect();
        return;
    }

    players[socket.id] = { id: socket.id, username: 'Guest-' + Math.floor(Math.random() * 9000000), pos: { x: 0, y: 1.7, z: 0 }, rot: 0, lives: 5, isDead: false, isHiding: false };

    socket.emit('init', { id: socket.id, players, gameState });
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('setUsername', (name) => { if (name.trim().length > 0) players[socket.id].username = name.trim(); });

    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].pos = data.pos;
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, pos: data.pos, rot: data.rot });
        }
    });

    socket.on('setHiding', (isHiding) => {
        if (players[socket.id]) {
            players[socket.id].isHiding = isHiding;
            socket.broadcast.emit('playerHiding', { id: socket.id, isHiding: isHiding });
        }
    });

    socket.on('makeNoise', (pos) => io.emit('noiseMade', pos));

    // NEW: Sync Tung Tung getting shot!
    socket.on('shootTungTung', () => {
        io.emit('tungTungKnockedOut');
    });

    socket.on('itemAction', (data) => {
        const item = gameState.items[data.itemId];
        if (item) {
            if (data.action === 'pickup') { item.holder = socket.id; item.visible = false; } 
            else if (data.action === 'drop') { item.holder = null; item.visible = true; item.pos = data.pos; }
            io.emit('itemUpdate', { itemId: data.itemId, itemState: item });
        }
    });

    socket.on('puzzleSolved', (data) => {
        if (gameState.puzzles[data.obstacleId]) {
            gameState.puzzles[data.obstacleId].solved = true;
            io.emit('puzzleUpdate', { obstacleId: data.obstacleId });
            
            // If weapons case is opened, spawn the crossbow!
            if (data.obstacleId === 'weaponsCase') {
                gameState.items['crossbow'].visible = true;
                io.emit('itemUpdate', { itemId: 'crossbow', itemState: gameState.items['crossbow'] });
            }

            if (data.obstacleId === 'mainDoor') {
                io.emit('gameWon', players[socket.id].username);
                resetServerState();
            }
        }
    });

    socket.on('playerDied', () => {
        if (players[socket.id]) {
            players[socket.id].lives -= 1;
            if (players[socket.id].lives <= 0) {
                players[socket.id].isDead = true;
                socket.broadcast.emit('playerEliminated', socket.id);
                if (Object.values(players).every(p => p.isDead)) { io.emit('gameOverAll'); resetServerState(); }
            }
        }
    });

    socket.on('disconnect', () => {
        for (const [key, item] of Object.entries(gameState.items)) {
            if (item.holder === socket.id) { item.holder = null; item.visible = true; io.emit('itemUpdate', { itemId: key, itemState: item }); }
        }
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

function resetServerState() {
    Object.keys(gameState.puzzles).forEach(k => gameState.puzzles[k].solved = false);
    Object.keys(gameState.items).forEach(k => { gameState.items[k].holder = null; gameState.items[k].visible = (k !== 'crossbow'); });
    Object.keys(players).forEach(k => { players[k].lives = 5; players[k].isDead = false; players[k].isHiding = false; });
    io.emit('serverReset', gameState);
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`Server cooking on port ${PORT}`));
