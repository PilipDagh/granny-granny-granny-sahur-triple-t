const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = process.env.PORT || 3000;

// ==== Serve Static Files ====
app.use(express.static(path.join(__dirname)));

// Send the game files for the base route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ==== Create HTTP Server ====
const server = http.createServer(app);

// ==== WebSocket Integration ====
const io = new Server(server);

// ==== Game Variables ====
const players = {}; // Stores player data { socketId: { x, y } }
let granny = { x: 500, y: 300, direction: "left" }; // Granny's position for all players

// ==== Real-Time WebSocket Connections ====
io.on("connection", (socket) => {
  console.log(`A player connected: ${socket.id}`);

  // Add new player to players object
  players[socket.id] = {
    x: Math.random() * 800, // Random starting positions
    y: Math.random() * 600,
  };

  // Send game state to the new player
  socket.emit("currentPlayers", players);
  socket.emit("grannyPosition", granny);

  // Notify other players about the new player
  socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });

  // Handle player movements
  socket.on("playerMovement", (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;

      // Broadcast updated player movement to all players
      socket.broadcast.emit("playerMoved", { id: socket.id, ...players[socket.id] });
    }
  });

  // Handle player disconnection
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);

    // Remove the player from the game
    delete players[socket.id];

    // Notify remaining players
    io.emit("playerDisconnected", socket.id);
  });
});

// ==== Granny AI Simulation ====
setInterval(() => {
  const speed = 2;

  if (granny.direction === "left") {
    granny.x -= speed;
    if (granny.x <= 0) granny.direction = "right";
  } else {
    granny.x += speed;
    if (granny.x >= 800) granny.direction = "left";
  }

  // Broadcast Granny's movement to all players
  io.emit("grannyMoved", granny);
}, 1000 / 60); // Update every 60 milliseconds

// ==== Start Server ====
server.listen(PORT, () => {
  console.log(`Game server running on http://localhost:${PORT}`);
});