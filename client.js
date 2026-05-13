// Client-side game logic
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

// Set canvas size
canvas.width = window.innerWidth / 1.2;
canvas.height = window.innerHeight / 1.2;

// Player properties
const player = {
  x: 50,
  y: 50,
  width: 30,
  height: 30,
  color: "blue",
  speed: 5,
};

// AI properties (Tung Tung Tung Sahur character)
const enemy = {
  x: canvas.width - 100,
  y: canvas.height - 100,
  width: 30,
  height: 30,
  color: "red",
  speed: 2,
};

// Key states
const keys = {};

// Event listeners for keypresses
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

// Game loop
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Player movement
  if (keys["w"] || keys["ArrowUp"]) player.y -= player.speed;
  if (keys["s"] || keys["ArrowDown"]) player.y += player.speed;
  if (keys["a"] || keys["ArrowLeft"]) player.x -= player.speed;
  if (keys["d"] || keys["ArrowRight"]) player.x += player.speed;

  // Bounds checking for player
  if (player.x < 0) player.x = 0;
  if (player.y < 0) player.y = 0;
  if (player.x + player.width > canvas.width) player.x = canvas.width - player.width;
  if (player.y + player.height > canvas.height) player.y = canvas.height - player.height;

  // Enemy (Tung Tung) basic AI movement (follows player)
  if (player.x > enemy.x) enemy.x += enemy.speed;
  if (player.x < enemy.x) enemy.x -= enemy.speed;
  if (player.y > enemy.y) enemy.y += enemy.speed;
  if (player.y < enemy.y) enemy.y -= enemy.speed;

  // Draw player
  ctx.fillStyle = player.color;
  ctx.fillRect(player.x, player.y, player.width, player.height);

  // Draw enemy
  ctx.fillStyle = enemy.color;
  ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

  // Collision detection
  if (
    player.x < enemy.x + enemy.width &&
    player.x + player.width > enemy.x &&
    player.y < enemy.y + enemy.height &&
    player.y + player.height > enemy.y
  ) {
    alert("You were caught by Tung Tung Tung Sahur! GAME OVER.");
    // Reset positions on game over
    player.x = 50;
    player.y = 50;
    enemy.x = canvas.width - 100;
    enemy.y = canvas.height - 100;
  }

  requestAnimationFrame(gameLoop);
}

gameLoop();