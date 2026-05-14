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

// --- 5 ITEM PRESETS (Granny Style) ---
const PRESETS = [
    { hammer: {x: 15, y: -3.5, z: -25}, pliers: {x: 12, y: 0.5, z: 5}, master_key: {x: 0, y: 8.5, z: 0}, weapons_key: {x: -3, y: 0.5, z: 8}, gas_can: {x: 25, y: -3.5, z: -25}, car_key: {x: 5, y: 8.5, z: 5}, battery: {x: 10, y: 0.5, z: -5} },
    { hammer: {x: 0, y: 8.5, z: 0}, pliers: {x: 15, y: -3.5, z: -25}, master_key: {x: 12, y: 0.5, z: 5}, weapons_key: {x: 25, y: -3.5, z: -25}, gas_can: {x: -3, y: 0.5, z: 8}, car_key: {x: 10, y: 0.5, z: -5}, battery: {x: 5, y: 8.5, z: 5} },
    { hammer: {x: 12, y: 0.5, z: 5}, pliers: {x: 0, y: 8.5, z: 0}, master_key: {x: 15, y: -3.5, z: -25}, weapons_key: {x: 5, y: 8.5, z: 5}, gas_can: {x: 10, y: 0.5, z: -5}, car_key: {x: 25, y: -3.5, z: -25}, battery: {x: -3, y: 0.5, z: 8} },
    { hammer: {x: 25, y: -3.5, z: -25}, pliers: {x: -3, y: 0.5, z: 8}, master_key: {x: 10, y: 0.5, z: -5}, weapons_key: {x: 12, y: 0.5, z: 5}, gas_can: {x: 5, y: 8.5, z: 5}, car_key: {x: 15, y: -3.5, z: -25}, battery: {x: 0, y: 8.5, z: 0} },
    { hammer: {x: 5, y: 8.5, z: 5}, pliers: {x: 10, y: 0.5, z: -5}, master_key: {x: -3, y: 0.5, z: 8}, weapons_key: {x: 0, y: 8.5, z: 0}, gas_can: {x: 15, y: -3.5, z: -25}, car_key: {x: 12, y: 0.5, z: 5}, battery: {x: 25, y: -3.5, z: -25} }
];

let currentPresetIndex = Math.floor(Math.random() * PRESETS.length);
let players = {};
let gameState = { items: {}, puzzles: {}, carParts: { gas: false, battery: false, key: false } };

function loadPreset() {
    const p = PRESETS[currentPresetIndex];
    gameState.items = {
        'hammer': { pos: p.hammer, holder: null, visible: true },
        'pliers': { pos: p.pliers, holder: null, visible: true },
        'master_key': { pos: p.master_key, holder: null, visible: true },
        'weapons_key': { pos: p.weapons_key, holder: null, visible: true },
        'crossbow': { pos: {x: 22, y: 0.5, z: 8}, holder: null, visible: false },
        'gas_can': { pos: p.gas_can, holder: null, visible: true },
        'car_key': { pos: p.car_key, holder: null, visible: true },
        'battery': { pos: p.battery, holder: null, visible: true }
    };
    gameState.puzzles = { 'barricade': { solved: false }, 'circuitBox': { solved: false }, 'mainDoor': { solved: false }, 'weaponsCase': { solved: false } };
    gameState.carParts = { gas: false, battery: false, key: false };
}
loadPreset();

io.on('connection', (socket) => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull', 'Server is full.');
        socket.disconnect();
        return;
    }

    // 0.67% Chance for Domain Expansion!
    const hasDomain = Math.random() < 0.0067;

    players[socket.id] = { 
        id: socket.id, username: 'Guest-' + Math.floor(Math.random() * 9000000), 
        pos: { x: 0, y: 9.7, z: 0 }, // Spawn UPSTAIRS
        rot: 0, lives: 5, isDead: false, isHiding: false, hasDomain: hasDomain,
        customization: { hair: '#000000', clothes: '#2244aa', skin: '#ffccaa', pants: '#111111', shoes: '#333333' }
    };

    socket.emit('init', { id: socket.id, players, gameState, presetIndex: currentPresetIndex });
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('setUsername', (name) => { if (name.trim().length > 0) players[socket.id].username = name.trim(); });

    // Customization Sync
    socket.on('updateCustomization', (colors) => {
        if (players[socket.id]) {
            players[socket.id].customization = colors;
            io.emit('playerCustomized', { id: socket.id, colors: colors });
        }
    });

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
    socket.on('shootTungTung', () => io.emit('tungTungKnockedOut'));

    // Domain Expansion Sync
    socket.on('activateDomain', (pos) => {
        if (players[socket.id] && players[socket.id].hasDomain) {
            io.emit('domainActivated', { id: socket.id, pos: pos });
        }
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
            if (data.obstacleId === 'weaponsCase') {
                gameState.items['crossbow'].visible = true;
                io.emit('itemUpdate', { itemId: 'crossbow', itemState: gameState.items['crossbow'] });
            }
            if (data.obstacleId === 'mainDoor') {
                io.emit('gameWon', { winner: players[socket.id].username, type: 'Front Door' });
                resetServerState();
            }
        }
    });

    // Car Escape Logic
    socket.on('carPartAdded', (part) => {
        gameState.carParts[part] = true;
        io.emit('carUpdate', gameState.carParts);
        if (gameState.carParts.gas && gameState.carParts.battery && gameState.carParts.key) {
            io.emit('gameWon', { winner: players[socket.id].username, type: 'Car' });
            resetServerState();
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
    currentPresetIndex = Math.floor(Math.random() * PRESETS.length);
    loadPreset();
    Object.keys(players).forEach(k => { players[k].lives = 5; players[k].isDead = false; players[k].isHiding = false; });
    io.emit('serverReset', { gameState, presetIndex: currentPresetIndex });
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`Server cooking on port ${PORT}`));
