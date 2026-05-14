import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, controls, socket;
let isMultiplayer = false;
let myId = null;
let remotePlayers = {};
let gameItems = {};
let gamePuzzles = {};
let granny = null; // The Tung Tung Monster

// Player State
let lives = 5;
let isDead = false;
let inventory = null;
let currentDay = 1;
let isHiding = false;
window.noiseTarget = null;
window.noiseTimer = 0;

// Movement & Mobile State
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let mobileEnabled = false;
let lookSensitivity = 0.005;
let mobileMoveData = { x: 0, y: 0 };
let mobileLookData = { x: 0, y: 0 };

// --- DOM ELEMENTS ---
const uiMainMenu = document.getElementById('main-menu');
const uiSettings = document.getElementById('settings-menu');
const uiPause = document.getElementById('pause-menu');
const uiGame = document.getElementById('game-ui');
const uiDeath = document.getElementById('death-screen');
const uiDayText = document.getElementById('day-text');
const uiLives = document.getElementById('lives-display');
const uiInventory = document.getElementById('inventory-display');
const uiInteract = document.getElementById('interact-prompt');

// --- PROCEDURAL TEXTURE GENERATOR ---
// We generate the wood textures via HTML Canvas so no image files are needed!
function createWoodTexture(baseColor, lineColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Base color
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);
    
    // Wood grain lines
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        let x = Math.random() * 512;
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (Math.random()*50 - 25), 170, x + (Math.random()*50 - 25), 340, x + (Math.random()*50 - 25), 512);
        ctx.stroke();
    }
    
    // Horizontal plank lines
    ctx.strokeStyle = '#110a05';
    ctx.lineWidth = 4;
    for (let i = 0; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

const wallTexture = createWoodTexture('#3d2b22', '#2a1a10');
const floorTexture = createWoodTexture('#1a1008', '#0a0502');
floorTexture.repeat.set(4, 4);

// --- WEB AUDIO API: TUNG TUNG SYNTHESIZER ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTungSound(distance) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    // Volume based on distance (closer = louder)
    let vol = Math.max(0, 1 - (distance / 30)); 
    if (vol <= 0) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // Wood block sound characteristics
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime); // Deep pitch
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1); // Quick drop
    
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15); // Quick fade
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

// Rhythmic Sahur loop
setInterval(() => {
    if (granny && camera && !isDead && uiGame.classList.contains('hidden') === false) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 30) {
            playTungSound(dist);
            setTimeout(() => playTungSound(dist), 250);
            setTimeout(() => playTungSound(dist), 500);
        }
    }
}, 2000);

// --- ENGINE INITIALIZATION ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    scene.fog = new THREE.FogExp2(0x020202, 0.12); // Spooky fog

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.7, 0); // Player height

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    // Flashlight attached to camera
    const flashlight = new THREE.SpotLight(0xffffff, 1.5, 20, Math.PI / 5, 0.5, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);

    // Dim ambient light
    const ambientLight = new THREE.AmbientLight(0x111111);
    scene.add(ambientLight);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- UI & MENU LOGIC ---
document.getElementById('btn-settings').addEventListener('click', () => {
    uiMainMenu.classList.add('hidden');
    uiSettings.classList.remove('hidden');
});

document.getElementById('btn-back-settings').addEventListener('click', () => {
    uiSettings.classList.add('hidden');
    uiMainMenu.classList.remove('hidden');
});

document.getElementById('sensitivity').addEventListener('input', (e) => {
    document.getElementById('sens-val').innerText = e.target.value;
    lookSensitivity = e.target.value * 0.001;
});

document.getElementById('mobile-toggle').addEventListener('change', (e) => {
    mobileEnabled = e.target.checked;
});

document.getElementById('btn-singleplayer').addEventListener('click', () => startGame(false));
document.getElementById('btn-multiplayer').addEventListener('click', () => startGame(true));

function startGame(multi) {
    isMultiplayer = multi;
    const username = document.getElementById('username-input').value || 'Guest-' + Math.floor(Math.random() * 9000);
    
    uiMainMenu.classList.add('hidden');
    uiGame.classList.remove('hidden');
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    // buildHouse(); // Will be added in Chunk 3
    // buildItems(); // Will be added in Chunk 4
    // setupMobileControls(); // Will be added in Chunk 5

    if (isMultiplayer) {
        connectToServer(username);
    } else {
        if (!mobileEnabled) controls.lock();
    }
    
    // animate(); // Will be added in Chunk 5
}

// --- MULTIPLAYER CONNECTION (STUB FOR NEXT CHUNK) ---
function connectToServer(username) {
    socket = io();
    socket.on('connect', () => {
        socket.emit('setUsername', username);
    });
    
    socket.on('serverFull', (msg) => {
        alert(msg);
        location.reload();
    });
    socket.on('playerHiding', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].userData.isHiding = data.isHiding;
            remotePlayers[data.id].visible = !data.isHiding; // Hide their avatar
        }
    });
    socket.on('noiseMade', (pos) => {
        window.noiseTarget = new THREE.Vector3(pos.x, pos.y, pos.z);
        window.noiseTimer = 8.0;
    });

    // We will handle playerJoined, playerMoved, etc., in Chunk 4
}
// --- CONTINUING FROM PART 1 ---

// --- HOUSE CONSTRUCTION HELPER ---
const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9 });
const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8 });

function createWall(x, z, width, rotationY = 0) {
    // Walls are 4 units high, 0.5 units thick
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 4, 0.5), wallMaterial);
    wall.position.set(x, 2, z); // Y is 2 so the bottom is at 0
    wall.rotation.y = rotationY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
}

function buildHouse() {
    // 1. Floor & Ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4;
    scene.add(ceiling);

    // 2. The Bedroom (Spawn Room)
    createWall(0, -5, 10); 
    createWall(-5, 0, 10, Math.PI / 2); 
    createWall(5, 2.5, 5, Math.PI / 2); 
    createWall(0, 5, 10); 

    // THE BED (Now Interactive!)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 6), new THREE.MeshStandardMaterial({color: 0x331111}));
    bed.position.set(-3, 0.4, -1);
    bed.name = "OBSTACLE_bed"; // Added name so Raycaster finds it
    scene.add(bed);

    // 3. Hallways & Maze
    createWall(10, 5, 20, Math.PI / 2); 
    createWall(15, -5, 10); 
    createWall(20, 0, 10, Math.PI / 2); 
    
    // 4. THE BASEMENT (New Area!)
    // Ramp going down
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 12), floorMaterial);
    ramp.position.set(15, -2, -15);
    ramp.rotation.x = Math.PI / 5;
    scene.add(ramp);
    
    // Basement Floor
    const basementFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMaterial);
    basementFloor.position.set(15, -4, -25);
    basementFloor.rotation.x = -Math.PI / 2;
    scene.add(basementFloor);

    // Basement Walls (Custom Y position for basement)
    const bWall1 = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.5), wallMaterial);
    bWall1.position.set(15, -2, -35);
    scene.add(bWall1);
    const bWall2 = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.5), wallMaterial);
    bWall2.position.set(5, -2, -25);
    bWall2.rotation.y = Math.PI/2;
    scene.add(bWall2);
    const bWall3 = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.5), wallMaterial);
    bWall3.position.set(25, -2, -25);
    bWall3.rotation.y = Math.PI/2;
    scene.add(bWall3);

    // 5. The Main Entrance & Door
    createWall(0, 20, 20); 
    createWall(-10, 12.5, 15, Math.PI / 2); 
    createWall(10, 12.5, 15, Math.PI / 2); 

    const doorGroup = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.2), new THREE.MeshStandardMaterial({color: 0x550000}));
    doorMesh.position.set(0, 1.9, 19.9);
    doorGroup.add(doorMesh);

    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 0.3), new THREE.MeshStandardMaterial({map: wallTexture}));
    plank.position.set(0, 2, 19.7);
    plank.name = "OBSTACLE_barricade";
    doorGroup.add(plank);

    const wires = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    wires.position.set(1.2, 1.5, 19.7);
    wires.name = "OBSTACLE_circuitBox";
    doorGroup.add(wires);

    const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({color: 0xaaaaaa}));
    padlock.position.set(-0.5, 1.8, 19.7);
    padlock.name = "OBSTACLE_mainDoor";
    doorGroup.add(padlock);

    scene.add(doorGroup);
}
// --- PROCEDURAL TUNG TUNG SAHUR MONSTER ---
function createTungTungModel() {
    const group = new THREE.Group();

    // The Kentongan Body (Hollow Wood Block)
    const bodyGeom = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ map: wallTexture, color: 0x5c4033 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 1.5;
    body.castShadow = true;
    group.add(body);

    // The Slit (Makes it look like a real Kentongan instrument)
    const slitGeom = new THREE.BoxGeometry(0.2, 1.2, 0.6);
    const slitMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const slit = new THREE.Mesh(slitGeom, slitMat);
    slit.position.set(0.45, 1.5, 0);
    group.add(slit);

    // The Head
    const headGeom = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const head = new THREE.Mesh(headGeom, bodyMat);
    head.position.y = 2.7;
    head.castShadow = true;
    group.add(head);

    // Glowing Red Eyes
    const eyeGeom = new THREE.SphereGeometry(0.08, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(0.2, 2.8, 0.3);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(-0.2, 2.8, 0.3);
    
    // Add a red point light to the eyes for maximum horror
    const eyeLight = new THREE.PointLight(0xff0000, 1, 5);
    eyeLight.position.set(0, 2.8, 0.4);
    
    group.add(leftEye, rightEye, eyeLight);

    // Stick Arms
    const armGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.2);
    const leftArm = new THREE.Mesh(armGeom, bodyMat);
    leftArm.position.set(0.6, 1.5, 0);
    leftArm.rotation.z = Math.PI / 8;
    const rightArm = new THREE.Mesh(armGeom, bodyMat);
    rightArm.position.set(-0.6, 1.5, 0);
    rightArm.rotation.z = -Math.PI / 8;
    group.add(leftArm, rightArm);

    return group;
}

function spawnTungTung() {
    granny = createTungTungModel();
    granny.position.set(0, 0, 15); // Spawn him near the exit
    scene.add(granny);
}

// --- MULTIPLAYER AVATAR GENERATOR ---
function createPlayerAvatar(id, username) {
    const group = new THREE.Group();
    
    // Simple humanoid shape for other players
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), new THREE.MeshStandardMaterial({color: 0x2244aa}));
    body.position.y = 0.7;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({color: 0xffccaa}));
    head.position.y = 1.65;
    group.add(head);

    // Username Label (Canvas Text)
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.font = '32px Courier Prime';
    ctx.textAlign = 'center';
    ctx.fillText(username, 128, 40);
    
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 2.2;
    sprite.scale.set(2, 0.5, 1);
    group.add(sprite);

    group.name = id;
    scene.add(group);
    return group;
}
// --- CONTINUING FROM PART 2 ---

// --- ITEM GENERATION ---
const itemMeshes = {};

function createItemMesh(type) {
    const group = new THREE.Group();
    if (type === 'hammer') {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6), new THREE.MeshStandardMaterial({color: 0x8b4513}));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.15), new THREE.MeshStandardMaterial({color: 0x555555}));
        head.position.y = 0.3;
        group.add(handle, head);
    } else if (type === 'pliers') {
        const handle1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000}));
        handle1.position.set(0.05, 0, 0);
        handle1.rotation.z = 0.2;
        const handle2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000}));
        handle2.position.set(-0.05, 0, 0);
        handle2.rotation.z = -0.2;
        group.add(handle1, handle2);
    } else if (type === 'master_key') {
        const keyBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({color: 0xffd700}));
        const keyTeeth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), new THREE.MeshStandardMaterial({color: 0xffd700}));
        keyTeeth.position.set(0.1, 0.15, 0);
        group.add(keyBase, keyTeeth);
    }
    return group;
}

function buildItems(initialState) {
    // initialState comes from the server (or local defaults if single player)
    const itemsData = initialState ? initialState.items : {
        'hammer': { pos: {x: -8, y: 0.5, z: -12}, visible: true },
        'pliers': { pos: {x: 12, y: 0.5, z: 5}, visible: true },
        'master_key': { pos: {x: 0, y: 4.5, z: 0}, visible: true } // Attic key
    };

    for (const [id, data] of Object.entries(itemsData)) {
        const mesh = createItemMesh(id);
        mesh.position.set(data.pos.x, data.pos.y, data.pos.z);
        mesh.name = `ITEM_${id}`;
        mesh.visible = data.visible;
        scene.add(mesh);
        itemMeshes[id] = mesh;
    }
}

// --- INTERACTION RAYCASTER ---
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
let currentTarget = null;

function checkInteractions() {
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    currentTarget = null;
    uiInteract.innerText = "";

    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && obj.parent.type !== 'Scene') {
            if (obj.name.startsWith("ITEM_") || obj.name.startsWith("OBSTACLE_")) break;
            obj = obj.parent;
        }

        const distance = intersects[0].distance;

        if (distance < 3.0) {
            if (obj.name.startsWith("ITEM_") && obj.visible) {
                const itemName = obj.name.replace("ITEM_", "");
                uiInteract.innerText = `Press E to pick up ${itemName.replace('_', ' ')}`;
                currentTarget = { type: 'item', id: itemName, obj: obj };
            } 
            else if (obj.name.startsWith("OBSTACLE_") && obj.visible) {
                const obsName = obj.name.replace("OBSTACLE_", "");
                
                // NEW: Bed Hiding Logic
                if (obsName === 'bed') {
                    uiInteract.innerText = isHiding ? "Press E to get out" : "Press E to hide under bed";
                    currentTarget = { type: 'obstacle', id: obsName, obj: obj };
                    return;
                }

                let requiredItem = "";
                if (obsName === 'barricade') requiredItem = 'hammer';
                if (obsName === 'circuitBox') requiredItem = 'pliers';
                if (obsName === 'mainDoor') requiredItem = 'master_key';

                if (inventory === requiredItem) {
                    uiInteract.innerText = `Press E to use ${requiredItem.replace('_', ' ')}`;
                    currentTarget = { type: 'obstacle', id: obsName, obj: obj };
                } else {
                    uiInteract.innerText = `Requires: ${requiredItem.replace('_', ' ')}`;
                }
            }
        }
    }
}

function performInteraction() {
    if (!currentTarget) return;

    if (currentTarget.type === 'item') {
        if (inventory) dropItem();
        inventory = currentTarget.id;
        uiInventory.innerText = `Holding: ${inventory.replace('_', ' ')}`;
        if (isMultiplayer) socket.emit('itemAction', { itemId: inventory, action: 'pickup' });
        else currentTarget.obj.visible = false;
    } 
    else if (currentTarget.type === 'obstacle') {
        // NEW: Bed Hiding Toggle
        if (currentTarget.id === 'bed') {
            isHiding = !isHiding;
            if (isHiding) {
                camera.position.set(-3, 0.2, -1); // Move camera under the bed
                uiInteract.innerText = "HIDING...";
            } else {
                camera.position.set(0, 1.7, 0); // Stand back up
            }
            if (isMultiplayer) socket.emit('setHiding', isHiding);
            return;
        }

        if (isMultiplayer) socket.emit('puzzleSolved', { obstacleId: currentTarget.id });
        else {
            currentTarget.obj.visible = false;
            if (currentTarget.id === 'mainDoor') winGame();
        }
        inventory = null;
        uiInventory.innerText = `Holding: Nothing`;
    }
}

function dropItem() {
    if (!inventory) return;
    
    const dropPos = new THREE.Vector3();
    camera.getWorldDirection(dropPos);
    dropPos.multiplyScalar(1.5).add(camera.position);
    dropPos.y = camera.position.y > 0 ? 0.5 : -3.5; // Adjust drop height if in basement

    // NEW: Noise Attraction Logic
    window.noiseTarget = dropPos.clone();
    window.noiseTimer = 8.0; // Tung Tung investigates for 8 seconds
    
    if (isMultiplayer) {
        socket.emit('itemAction', { itemId: inventory, action: 'drop', pos: dropPos });
        socket.emit('makeNoise', dropPos); // Tell server a noise was made
    } else {
        const mesh = itemMeshes[inventory];
        mesh.position.copy(dropPos);
        mesh.visible = true;
    }
    
    inventory = null;
    uiInventory.innerText = `Holding: Nothing`;
}

// Keyboard Listeners
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') performInteraction();
    if (e.code === 'KeyQ') dropItem();
});

// Mobile Interaction Buttons
document.getElementById('mobile-interact').addEventListener('touchstart', performInteraction);
document.getElementById('mobile-drop').addEventListener('touchstart', dropItem);

// --- MULTIPLAYER SOCKET.IO SYNCING ---
// Fleshing out the stub from Chunk 2
function connectToServer(username) {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('setUsername', username);
    });

    socket.on('init', (data) => {
        myId = data.id;
        
        // Build map and items based on server state
        buildHouse();
        buildItems(data.gameState);
        spawnTungTung();

        // Sync existing puzzles
        for (const [obsId, obsData] of Object.entries(data.gameState.puzzles)) {
            if (obsData.solved) {
                const mesh = scene.getObjectByName(`OBSTACLE_${obsId}`);
                if (mesh) mesh.visible = false;
            }
        }

        // Spawn existing players
        for (const [id, pData] of Object.entries(data.players)) {
            if (id !== myId && !pData.isDead) {
                remotePlayers[id] = createPlayerAvatar(id, pData.username);
                remotePlayers[id].position.copy(pData.pos);
            }
        }

        // Start the game loop
        if (!mobileEnabled) controls.lock();
        animate();
    });

    socket.on('playerJoined', (pData) => {
        remotePlayers[pData.id] = createPlayerAvatar(pData.id, pData.username);
    });

    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            // Smooth interpolation could be added here, but direct copy works for now
            remotePlayers[data.id].position.copy(data.pos);
            remotePlayers[data.id].rotation.y = data.rot;
        }
    });

    socket.on('playerLeft', (id) => {
        if (remotePlayers[id]) {
            scene.remove(remotePlayers[id]);
            delete remotePlayers[id];
        }
    });

    socket.on('playerEliminated', (id) => {
        if (remotePlayers[id]) {
            scene.remove(remotePlayers[id]);
            delete remotePlayers[id];
        }
    });

    socket.on('itemUpdate', (data) => {
        const mesh = itemMeshes[data.itemId];
        if (mesh) {
            mesh.visible = data.itemState.visible;
            if (data.itemState.pos) {
                mesh.position.copy(data.itemState.pos);
            }
        }
    });

    socket.on('puzzleUpdate', (data) => {
        const mesh = scene.getObjectByName(`OBSTACLE_${data.obstacleId}`);
        if (mesh) mesh.visible = false;
    });

    socket.on('gameWon', (winnerName) => {
        alert(`ESCAPE SUCCESSFUL! ${winnerName} unlocked the door!`);
        location.reload();
    });

    socket.on('gameOverAll', () => {
        alert(`TUNG TUNG SAHUR KILLED EVERYONE. Game Over.`);
        location.reload();
    });
}
// --- CONTINUING FROM PART 3 ---

// --- PLAYER MOVEMENT & CONTROLS ---
let isSprinting = false;

const onKeyDown = function (event) {
    if (isDead) return;
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward = true; break;
        case 'ArrowRight': case 'KeyD': moveRight = true; break;
        case 'ShiftLeft': case 'ShiftRight': isSprinting = true; break;
    }
};

const onKeyUp = function (event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': moveRight = false; break;
        case 'ShiftLeft': case 'ShiftRight': isSprinting = false; break;
    }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// --- MOBILE JOYSTICK LOGIC ---
function setupMobileControls() {
    if (!mobileEnabled) return;
    
    document.getElementById('joystick-move').classList.remove('hidden');
    document.getElementById('joystick-look').classList.remove('hidden');
    document.getElementById('mobile-interact').classList.remove('hidden');
    document.getElementById('mobile-drop').classList.remove('hidden');

    const moveZone = document.getElementById('joystick-move');
    const lookZone = document.getElementById('joystick-look');

    // Move Joystick
    moveZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = moveZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Normalize between -1 and 1
        mobileMoveData.x = Math.max(-1, Math.min(1, (touch.clientX - centerX) / 40));
        mobileMoveData.y = Math.max(-1, Math.min(1, (touch.clientY - centerY) / 40));
    }, { passive: false });

    moveZone.addEventListener('touchend', () => {
        mobileMoveData = { x: 0, y: 0 };
    });

    // Look Joystick
    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = lookZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const deltaX = (touch.clientX - centerX) * lookSensitivity;
        const deltaY = (touch.clientY - centerY) * lookSensitivity;
        
        // Apply rotation directly to camera
        camera.rotation.y -= deltaX;
        camera.rotation.x -= deltaY;
        
        // Clamp pitch (looking up/down)
        camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    }, { passive: false });
}

// --- TUNG TUNG AI (STALKING LOGIC) ---
function updateTungTungAI(delta) {
    if (!granny || isDead) return;

    let targetPos = null;
    let minDistance = Infinity;

    // 1. PRIORITY: Investigate Noise!
    if (window.noiseTarget && window.noiseTimer > 0) {
        targetPos = window.noiseTarget;
        window.noiseTimer -= delta;
        
        // If he reaches the noise, he stops investigating
        if (granny.position.distanceTo(window.noiseTarget) < 1.5) {
            window.noiseTarget = null;
        }
    } 
    // 2. If no noise, hunt players
    else {
        if (isMultiplayer) {
            for (const [id, playerMesh] of Object.entries(remotePlayers)) {
                if (playerMesh.userData.isHiding) continue; // Ignore hiding players
                
                const dist = granny.position.distanceTo(playerMesh.position);
                if (dist < minDistance) {
                    minDistance = dist;
                    targetPos = playerMesh.position;
                }
            }
            // Check local player
            if (!isHiding) {
                const dist = granny.position.distanceTo(camera.position);
                if (dist < minDistance) {
                    minDistance = dist;
                    targetPos = camera.position;
                }
            }
        } else {
            // Single Player
            if (!isHiding) {
                targetPos = camera.position;
                minDistance = granny.position.distanceTo(camera.position);
            } else {
                // If hiding and no noise, Tung Tung wanders randomly (or stays still)
                targetPos = null; 
            }
        }
    }

    // Move towards the chosen target
    if (targetPos) {
        const lookTarget = new THREE.Vector3(targetPos.x, granny.position.y, targetPos.z);
        granny.lookAt(lookTarget);
        
        const speed = isMultiplayer ? 2.5 : 2.0;
        granny.translateZ(speed * delta);

        // Caught the local player!
        if (targetPos === camera.position && minDistance < 1.2 && !isHiding) {
            triggerDeath();
        }
    }
}
// --- DEATH & RESPAWN LOGIC ---
function triggerDeath() {
    if (isDead) return;
    isDead = true;
    lives--;
    currentDay++;
    
    if (isMultiplayer) socket.emit('playerDied');

    // Jumpscare effect
    camera.lookAt(granny.position);
    uiGame.classList.add('hidden');
    uiDeath.classList.remove('hidden');
    
    if (lives > 0) {
        uiDayText.innerText = `DAY ${currentDay}`;
        uiDeath.querySelector('#death-subtext').innerText = "Tung Tung Sahur caught you...";
        
        setTimeout(() => {
            respawnPlayer();
        }, 3000); // Wait 3 seconds then respawn
    } else {
        uiDayText.innerText = "GAME OVER";
        uiDayText.style.color = "#ff0000";
        uiDeath.querySelector('#death-subtext').innerText = "You are dead.";
        
        if (!isMultiplayer) {
            setTimeout(() => location.reload(), 3000);
        }
    }
}

function respawnPlayer() {
    isDead = false;
    uiDeath.classList.add('hidden');
    uiGame.classList.remove('hidden');
    uiLives.innerText = `Lives: ${lives}`;
    
    // Reset to bedroom
    camera.position.set(0, 1.7, 0);
    camera.rotation.set(0, 0, 0);
    
    // Reset Tung Tung position
    if (granny && !isMultiplayer) {
        granny.position.set(0, 0, 15);
    }
}

// Single Player Win Logic
function winGame() {
    alert("ESCAPE SUCCESSFUL! You unlocked the door!");
    location.reload();
}

// --- MAIN ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if (!isDead && (controls.isLocked || mobileEnabled)) {
        // 1. Raycaster check for items/puzzles
        checkInteractions();

        // 2. Physics & Movement
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // consistent movement in all directions

        // Add mobile joystick input
        if (mobileEnabled) {
            direction.x += mobileMoveData.x;
            direction.z -= mobileMoveData.y; 
        }

        // Replace the movement lines in animate() with this:
        if (!isHiding) {
            const currentSpeed = isSprinting ? 60.0 : 30.0;
            if (moveForward || moveBackward || mobileMoveData.y !== 0) velocity.z -= direction.z * currentSpeed * delta;
            if (moveLeft || moveRight || mobileMoveData.x !== 0) velocity.x -= direction.x * currentSpeed * delta;

            controls.moveRight(-velocity.x * delta);
            controls.moveForward(-velocity.z * delta);
        }
        // Basic boundary collision (keep player inside the house roughly)
        camera.position.y = 1.7; // Lock head height
        if (camera.position.x > 25) camera.position.x = 25;
        if (camera.position.x < -25) camera.position.x = -25;
        if (camera.position.z > 25) camera.position.z = 25;
        if (camera.position.z < -25) camera.position.z = -25;

        // 3. AI Update
        updateTungTungAI(delta);

        // 4. Multiplayer Position Sync
        if (isMultiplayer && socket && socket.connected) {
            // Throttle sync slightly to save bandwidth, but for now every frame is okay for small scale
            socket.emit('move', { pos: camera.position, rot: camera.rotation.y });
        }
    }

    renderer.render(scene, camera);
}

// --- FIXING SINGLE PLAYER STUBS FROM CHUNK 2 ---
// Override the startGame function to properly handle single player init
const originalStartGame = startGame;
window.startGame = function(multi) {
    isMultiplayer = multi;
    const username = document.getElementById('username-input').value || 'Guest-' + Math.floor(Math.random() * 9000);
    
    uiMainMenu.classList.add('hidden');
    uiGame.classList.remove('hidden');
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    setupMobileControls();

    if (isMultiplayer) {
        connectToServer(username);
    } else {
        // Single Player Initialization
        buildHouse();
        buildItems(null); // null uses local defaults
        spawnTungTung();
        
        if (!mobileEnabled) controls.lock();
        animate();
    }
};

// Pause Menu Logic
document.getElementById('pause-btn').addEventListener('click', () => {
    if (!isMultiplayer && !mobileEnabled) controls.unlock();
    uiPause.classList.remove('hidden');
});

document.getElementById('btn-resume').addEventListener('click', () => {
    uiPause.classList.add('hidden');
    if (!isMultiplayer && !mobileEnabled) controls.lock();
});

document.getElementById('btn-leave').addEventListener('click', () => {
    location.reload();
});

// Lock controls listener
if (controls) {
    controls.addEventListener('lock', function () {
        uiPause.classList.add('hidden');
    });
    controls.addEventListener('unlock', function () {
        if (!isDead && uiMainMenu.classList.contains('hidden')) {
            uiPause.classList.remove('hidden');
        }
    });
}
