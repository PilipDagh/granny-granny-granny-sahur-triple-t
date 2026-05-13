import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

let scene, camera, renderer, controls, socket;
let isMultiplayer = false;
let myId = null;
let remotePlayers = {};
let sensitivity = 0.002;

// DOM Elements
const mainMenu = document.getElementById('main-menu');
const settingsMenu = document.getElementById('settings-menu');
const gameUI = document.getElementById('game-ui');
const usernameInput = document.getElementById('username-input');

// Initialize 3D Scene
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x050505, 0.15);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    // Flashlight (Granny style)
    const flashlight = new THREE.SpotLight(0xffffff, 1, 15, Math.PI/6, 0.5);
    camera.add(flashlight);
    camera.add(flashlight.target);
    flashlight.target.position.set(0, 0, -1);
    scene.add(camera);
}

// Menu Buttons
document.getElementById('btn-multiplayer').onclick = () => {
    isMultiplayer = true;
    startLoadingGame();
};

document.getElementById('btn-singleplayer').onclick = () => {
    isMultiplayer = false;
    startLoadingGame();
};

document.getElementById('btn-settings').onclick = () => {
    mainMenu.classList.add('hidden');
    settingsMenu.classList.remove('hidden');
};

function startLoadingGame() {
    mainMenu.classList.add('hidden');
    gameUI.classList.remove('hidden');
    initEngine();
    if (isMultiplayer) {
        connectToServer();
    }
    // More loading logic...
}

function connectToServer() {
    socket = io();
    socket.on('init', (data) => {
        myId = data.id;
        // Build existing players...
    });
}

// --- CONTINUING FROM PART 1 ---

let moveJoystick, lookJoystick;
let mobileEnabled = false;
let items = [];
let granny;
let lives = 5;

// --- PROCEDURAL TUNG TUNG SAHUR MODEL ---
// This creates a realistic wood-textured "Kentongan Man"
function createTungTungModel() {
    const group = new THREE.Group();
    
    // Wood Texture for the body (Kentongan style)
    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 128; woodCanvas.height = 128;
    const ctx = woodCanvas.getContext('2d');
    ctx.fillStyle = '#4a2c1d';
    ctx.fillRect(0,0,128,128);
    ctx.strokeStyle = '#2a1a10';
    for(let i=0; i<20; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random()*128, 0);
        ctx.lineTo(Math.random()*128, 128);
        ctx.stroke();
    }
    const woodTex = new THREE.CanvasTexture(woodCanvas);

    const mat = new THREE.MeshStandardMaterial({ map: woodTex });

    // Torso (The Kentongan / Wood Block)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8), mat);
    body.position.y = 1.1;
    group.add(body);

    // The Slit in the Kentongan
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.5), new THREE.MeshBasicMaterial({color: 0x000000}));
    slit.position.set(0.35, 1.1, 0);
    group.add(slit);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.y = 1.9;
    group.add(head);

    // Glowing Eyes
    const eyeGeom = new THREE.SphereGeometry(0.05, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({color: 0xff0000});
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(0.2, 2.0, 0.15);
    eyeR.position.set(0.2, 2.0, -0.15);
    group.add(eyeL, eyeR);

    // Limbs (Thin wood sticks)
    const limbGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.8);
    const armL = new THREE.Mesh(limbGeom, mat);
    armL.position.set(0, 1.3, 0.6);
    armL.rotation.x = Math.PI/2;
    group.add(armL);

    group.castShadow = true;
    return group;
}

// --- MAP CONSTRUCTION (GRANNY HOUSE) ---
const wallTexture = (function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3d2b22';
    ctx.fillRect(0,0,256,256);
    ctx.strokeStyle = '#1a0f0a';
    ctx.lineWidth = 2;
    for(let i=0; i<10; i++) {
        ctx.strokeRect(0, i*25, 256, 25);
    }
    return new THREE.CanvasTexture(canvas);
})();

function createWall(x, z, w, h, rotY = 0) {
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.2),
        new THREE.MeshStandardMaterial({ map: wallTexture })
    );
    wall.position.set(x, h/2, z);
    wall.rotation.y = rotY;
    scene.add(wall);
    return wall;
}

function buildHouse() {
    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    floor.rotation.x = -Math.PI/2;
    scene.add(floor);

    // Bedroom (Start Room)
    createWall(0, -5, 10, 4); // Back
    createWall(-5, 0, 10, 4, Math.PI/2); // Left
    createWall(5, 0, 10, 4, Math.PI/2); // Right
    
    // Front Door Area (The Exit)
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.3), new THREE.MeshStandardMaterial({color: 0x770000}));
    doorFrame.position.set(0, 1.5, 15);
    doorFrame.name = "EXIT_DOOR";
    scene.add(doorFrame);

    // Granny (Tung Tung) spawn
    granny = createTungTungModel();
    granny.position.set(0, 0, 20);
    scene.add(granny);
}

// --- MOBILE CONTROLS (JOYSTICKS) ---
function setupMobile() {
    const moveZone = document.getElementById('joystick-move');
    const lookZone = document.getElementById('joystick-look');
    
    // Basic Touch State
    let moveData = { x: 0, y: 0 };
    let lookData = { x: 0, y: 0 };

    moveZone.addEventListener('touchstart', () => moveZone.style.opacity = "1");
    moveZone.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const rect = moveZone.getBoundingClientRect();
        moveData.x = (touch.clientX - (rect.left + rect.width/2)) / 60;
        moveData.y = (touch.clientY - (rect.top + rect.height/2)) / 60;
    });
    moveZone.addEventListener('touchend', () => {
        moveData = { x: 0, y: 0 };
        moveZone.style.opacity = "0.5";
    });

    return { moveData, lookData };
}

// --- INTERACTION SYSTEM (SYNCED) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);

function interact() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);
    
    if (intersects.length > 0) {
        const obj = intersects[0].object;
        if (intersects[0].distance < 3) {
            // If it's a Granny item (Hammer, Pliers, etc)
            if (obj.name.includes("ITEM")) {
                if (isMultiplayer) {
                    socket.emit('itemAction', { itemId: obj.uuid, action: 'pickup' });
                }
                obj.visible = false; // "Pick up"
            }
        }
    }
}

// Key Listeners
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') interact();
});

// --- MAIN ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    
    if (controls.isLocked || mobileEnabled) {
        const time = performance.now();
        const delta = (time - prevTime) / 1000;

        // Sync Granny movement (Simple AI)
        if (!isMultiplayer) {
            const dir = new THREE.Vector3().subVectors(camera.position, granny.position).normalize();
            granny.position.x += dir.x * 0.03;
            granny.position.z += dir.z * 0.03;
            granny.lookAt(camera.position.x, 0, camera.position.z);
            
            // Jumpscare/Death Logic
            if (granny.position.distanceTo(camera.position) < 1.5) {
                takeDamage();
            }
        }

        // Multiplayer Syncing
        if (isMultiplayer && socket) {
            socket.emit('move', {
                pos: camera.position,
                rot: camera.rotation.y
            });
        }

        renderer.render(scene, camera);
    }
}

function takeDamage() {
    lives--;
    document.getElementById('lives-display').innerText = `Lives: ${lives}`;
    if (lives <= 0) {
        alert("TUNGTUNGTUNG SAHUR! You are dead.");
        location.reload();
    } else {
        // Reset to bedroom
        camera.position.set(0, 1.7, 0);
    }
}
// --- CONTINUING FROM PART 2 ---

// Define the Puzzle Items (Carbon Copy of Granny)
const GAME_ITEMS = [
    { name: "Hammer", id: "item_hammer", color: 0x888888, pos: {x: -8, y: 0.5, z: -12}, room: "Basement" },
    { name: "Pliers", id: "item_pliers", color: 0x0000ff, pos: {x: 12, y: 0.5, z: 5}, room: "Kitchen" },
    { name: "Master Key", id: "item_key", color: 0xff0000, pos: {x: 0, y: 15, z: 0}, room: "Attic" },
    { name: "Cogwheel", id: "item_cog", color: 0xdaa520, pos: {x: 5, y: 0.5, z: -5}, room: "Secret Passage" },
    { name: "Melon", id: "item_melon", color: 0x00ff00, pos: {x: -5, y: 0.5, z: 10}, room: "Yard" }
];

let inventory = null;
let currentUsername = "";

// --- ENHANCED HOUSE CONSTRUCTION ---
function buildFullHouse() {
    // Basement (Downstairs)
    createWall(0, -15, 20, 4); // Basement Back
    createFloor(-10, -10, 20, 20, 0x111111); // Basement Floor

    // Kitchen & Dining (Ground Floor)
    createWall(10, 5, 10, 4); 
    createWall(15, 0, 10, 4, Math.PI/2); // Kitchen Side
    
    // Attic (Upstairs)
    const atticFloor = createFloor(0, 0, 15, 15, 0x221100);
    atticFloor.position.y = 4.5; // Elevated
    
    // Stairs (Simplified Ramp)
    const stairs = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 6), new THREE.MeshStandardMaterial({map: wallTexture}));
    stairs.position.set(5, 2, 8);
    stairs.rotation.x = -Math.PI/6;
    scene.add(stairs);

    // Spawn the Items
    GAME_ITEMS.forEach(itemData => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.2, 0.6),
            new THREE.MeshStandardMaterial({ color: itemData.color })
        );
        mesh.position.set(itemData.pos.x, itemData.pos.y, itemData.pos.z);
        mesh.name = `ITEM_${itemData.id}`;
        mesh.userData = { itemName: itemData.name };
        scene.add(mesh);
    });
}

function createFloor(x, z, w, d, color) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({color: color}));
    floor.rotation.x = -Math.PI/2;
    floor.position.set(x, 0, z);
    scene.add(floor);
    return floor;
}

// --- USERNAME & LOBBY LOGIC ---
function setupLobby() {
    const input = document.getElementById('username-input').value;
    currentUsername = input || "Guest-" + Math.floor(Math.random() * 9000000);
    
    if (isMultiplayer) {
        socket.emit('set_username', currentUsername);
    }
}

// --- MOBILE JOYSTICK SENSITIVITY ---
let moveForward = 0, moveRight = 0;
function updateMobileControls() {
    const sens = document.getElementById('sensitivity').value / 100;
    
    // Applying Joystick movement to camera
    const velocity = 0.1;
    camera.translateX(moveRight * velocity);
    camera.translateZ(moveForward * velocity);
    camera.position.y = 1.7; // Keep player head height level
}

// --- ITEM INTERACTION (SYNCED FOR 50 PLAYERS) ---
function handlePickup(mesh) {
    const itemName = mesh.userData.itemName;
    if (inventory) {
        // If already holding something, drop it
        dropItem(inventory);
    }
    inventory = itemName;
    mesh.visible = false;
    document.getElementById('interact-prompt').innerText = "Holding: " + itemName;

    if (isMultiplayer) {
        socket.emit('itemAction', { itemId: mesh.name, action: 'pickup', user: currentUsername });
    }
}

function dropItem(name) {
    // Logic to place item back on floor
    console.log("Dropped: " + name);
}

// --- THE "TUNG TUNG" SOUND SYNTHESIZER ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTungSound() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime); // Deep wood sound
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

// Rhythmic Sahur Sound Logic
setInterval(() => {
    if (granny && camera) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 15) {
            playTungSound();
            setTimeout(playTungSound, 300);
            setTimeout(playTungSound, 600); // Tung Tung Tung
        }
    }
}, 2000);

// --- MULTIPLAYER REAL-TIME SYNC ---
function connectToServer() {
    socket = io();
    
    socket.on('playerJoined', (data) => {
        // Create a 3D avatar for other players
        const playerMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 1.7, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x00ff00 })
        );
        playerMesh.name = data.id;
        scene.add(playerMesh);
        remotePlayers[data.id] = playerMesh;
    });

    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.copy(data.pos);
            remotePlayers[data.id].rotation.y = data.rot;
        }
    });

    socket.on('itemUpdate', (data) => {
        const itemMesh = scene.getObjectByName(data.itemId);
        if (itemMesh) {
            itemMesh.visible = (data.action === 'drop');
        }
    });
}
// --- CONTINUING FROM PART 3 ---

let lookSensitivity = 0.002;
let isPaused = false;

// --- PUZZLE OBJECTS (Obstacles) ---
const obstacles = {
    barricade: { itemNeeded: "Hammer", solved: false, pos: {x: 0, y: 1.5, z: 14.5} },
    circuitBox: { itemNeeded: "Pliers", solved: false, pos: {x: 14.5, y: 2, z: 0} },
    mainDoor: { itemNeeded: "Master Key", solved: false, pos: {x: 0, y: 1.5, z: 15} }
};

function buildObstacles() {
    // Plank on door (Hammer needed)
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 0.2), new THREE.MeshStandardMaterial({color: 0x5c4033}));
    plank.position.set(obstacles.barricade.pos.x, obstacles.barricade.pos.y, obstacles.barricade.pos.z);
    plank.name = "OBSTACLE_barricade";
    scene.add(plank);

    // Wires (Pliers needed)
    const wires = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    wires.position.set(obstacles.circuitBox.pos.x, obstacles.circuitBox.pos.y, obstacles.circuitBox.pos.z);
    wires.rotation.y = Math.PI/2;
    wires.name = "OBSTACLE_circuitBox";
    scene.add(wires);
}

// --- INTERACTION LOGIC ---
function tryUseItem() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);
    
    if (intersects.length > 0) {
        const obj = intersects[0].object;
        if (intersects[0].distance < 3) {
            
            // Pickup Logic
            if (obj.name.startsWith("ITEM_")) {
                handlePickup(obj);
            }
            
            // Solve Puzzle Logic
            if (obj.name.startsWith("OBSTACLE_")) {
                const obsKey = obj.name.split("_")[1];
                const data = obstacles[obsKey];
                
                if (inventory === data.itemNeeded) {
                    solvePuzzle(obsKey, obj);
                } else {
                    document.getElementById('interact-prompt').innerText = `Need ${data.itemNeeded}!`;
                }
            }
        }
    }
}

function solvePuzzle(key, mesh) {
    obstacles[key].solved = true;
    mesh.visible = false;
    inventory = null; // Use up item
    document.getElementById('interact-prompt').innerText = "Fixed!";
    
    if (isMultiplayer) {
        socket.emit('puzzleSolved', { obstacleId: key });
    }
    
    if (key === "mainDoor") {
        winGame();
    }
}

function winGame() {
    alert("YOU ESCAPED TUNG TUNG SAHUR!");
    location.reload();
}

// --- MOBILE LOOK JOYSTICK & SENSITIVITY ---
const lookState = { x: 0, y: 0 };
const moveState = { x: 0, y: 0 };

function initMobileLogic() {
    const lookZone = document.getElementById('joystick-look');
    const moveZone = document.getElementById('joystick-move');
    
    if (!document.getElementById('mobile-toggle').checked) return;
    
    mobileEnabled = true;
    lookZone.classList.remove('hidden');
    moveZone.classList.remove('hidden');

    lookZone.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const rect = lookZone.getBoundingClientRect();
        const sens = document.getElementById('sensitivity').value * 0.01;
        
        const dx = (touch.clientX - (rect.left + rect.width/2)) * sens;
        const dy = (touch.clientY - (rect.top + rect.height/2)) * sens;
        
        camera.rotation.y -= dx * 0.1;
        camera.rotation.x -= dy * 0.1;
    });
}

// --- PAUSE & MENU TOGGLES ---
document.getElementById('btn-back').onclick = () => {
    settingsMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
};

document.getElementById('pause-btn').onclick = () => {
    if (isMultiplayer) {
        pauseMenu.classList.toggle('hidden');
    } else {
        isPaused = !isPaused;
        pauseMenu.classList.toggle('hidden');
        if (!isPaused) controls.lock();
    }
};

document.getElementById('btn-resume').onclick = () => {
    isPaused = false;
    pauseMenu.classList.add('hidden');
    if (!isMultiplayer) controls.lock();
};

document.getElementById('btn-exit').onclick = () => location.reload();

// --- SPAWN LOGIC (UPSTAIRS FOR MULTIPLAYER) ---
function spawnPlayer() {
    if (isMultiplayer) {
        const spawns = [
            {x: 0, y: 1.7, z: 0}, 
            {x: 5, y: 6, z: 5}, // Attic
            {x: -5, y: 6, z: -5} // Attic Room 2
        ];
        const choice = spawns[Math.floor(Math.random() * spawns.length)];
        camera.position.set(choice.x, choice.y, choice.z);
    } else {
        camera.position.set(0, 1.7, 0); // Bedroom
    }
}

// --- FINAL UPDATED ANIMATION LOOP ---
let prevTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    
    if (isPaused) return;

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Tung Tung AI
    if (granny) {
        const speed = isMultiplayer ? 0.04 : 0.03;
        const target = camera.position;
        const dist = granny.position.distanceTo(target);
        
        if (dist < 20) {
            granny.lookAt(target.x, 0, target.z);
            const moveDir = new THREE.Vector3().subVectors(target, granny.position).normalize();
            granny.position.x += moveDir.x * speed;
            granny.position.z += moveDir.z * speed;
        }

        if (dist < 1.2) takeDamage();
    }

    // Multiplayer Pos Sync
    if (isMultiplayer && socket && socket.connected) {
        socket.emit('move', { pos: camera.position, rot: camera.rotation.y });
    }

    renderer.render(scene, camera);
    prevTime = time;
}

// START THE GAME
function startLoadingGame() {
    mainMenu.classList.add('hidden');
    gameUI.classList.remove('hidden');
    
    initEngine();
    buildHouse();
    buildObstacles();
    initMobileLogic();
    spawnPlayer();
    
    if (isMultiplayer) {
        connectToServer();
    } else {
        controls.lock();
    }
    
    animate();
}
