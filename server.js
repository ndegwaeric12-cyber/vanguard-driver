// vanguard-backend server.js
// - Relays control events from web clients to the Vanguard ESP32
// - Maintains a simple Park lock state so motors are ignored while parked
// - Broadcasts telemetry to all connected web clients

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Keep track of the connected Vanguard socket and park state
let vanguardSocket = null;
let parkState = {
  // single vanguard instance assumed; extendable by id
  vanguard: true // default parked for safety; set false to allow movement
};

// Simple HTTP health endpoint
app.get("/", (req, res) => res.send("Vanguard backend running"));

io.on("connection", (socket) => {
  console.log("client connected", socket.id);

  // Web clients and ESP32 should call identify after connecting
  socket.on("identify", (data) => {
    if (!data || !data.role) return;
    if (data.role === "vanguard") {
      vanguardSocket = socket;
      console.log("Vanguard identified:", socket.id);
      // When Vanguard connects, send current park state to it
      socket.emit("server_message", { type: "park_state", parked: !!parkState.vanguard });
    } else if (data.role === "web") {
      console.log("Web client identified:", socket.id);
      // send current park state to the web client so UI can reflect it
      socket.emit("server_message", { type: "park_state", parked: !!parkState.vanguard });
    }
  });

  // Web clients send control events
  socket.on("control", (msg) => {
    try {
      // Basic validation
      if (!msg || typeof msg !== "object") return;
      // If this is a park/gear command, update server state and broadcast
      if (msg.type === "gear" && msg.gear === "park") {
        parkState.vanguard = true;
        io.emit("server_message", { type: "park_state", parked: true });
        console.log("Park engaged by web client");
        // forward to vanguard so it can stop motors locally
        if (vanguardSocket) vanguardSocket.send(JSON.stringify({ type: "gear", gear: "park" }));
        return;
      }
      if (msg.type === "gear" && msg.gear === "forward") {
        // forward gear implies unpark
        parkState.vanguard = false;
        io.emit("server_message", { type: "park_state", parked: false });
      }
      if (msg.type === "gear" && msg.gear === "reverse") {
        parkState.vanguard = false;
        io.emit("server_message", { type: "park_state", parked: false });
      }
      if (msg.type === "gear" && msg.gear === "neutral") {
        // neutral does not change park state
      }

      // If the command is motor movement, enforce park lock on server
      if (msg.type === "motor" || msg.type === "steer_start" || msg.type === "steer_tick" || msg.type === "steer_tap") {
        if (parkState.vanguard) {
          // ignore motor/steer commands while parked
          console.log("Ignored motor/steer command while parked:", msg);
          // Optionally notify the sender
          socket.emit("server_message", { type: "error", message: "Vanguard is parked. Unpark to move." });
          return;
        }
      }

      // Relay everything else to Vanguard if connected
      if (vanguardSocket) {
        // send as raw JSON string to the vanguard socket
        vanguardSocket.send(JSON.stringify(msg));
        console.log("Relayed to vanguard:", msg);
      } else {
        console.log("No vanguard connected; control ignored:", msg);
        socket.emit("server_message", { type: "error", message: "Vanguard not connected" });
      }
    } catch (e) {
      console.error("control handler error", e);
    }
  });

  // Vanguard may send telemetry as raw messages (stringified JSON)
  socket.on("message", (m) => {
    try {
      const obj = typeof m === "string" ? JSON.parse(m) : m;
      if (obj && obj.type === "telemetry") {
        // Broadcast telemetry to all web clients
        io.emit("telemetry", obj);
      } else {
        // handle other messages from vanguard if needed
        io.emit("server_message", obj);
      }
    } catch (e) {
      console.warn("Invalid message payload", e);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("socket disconnected", socket.id, reason);
    if (vanguardSocket && socket.id === vanguardSocket.id) {
      vanguardSocket = null;
      console.log("Vanguard disconnected");
      // Optionally set park to true for safety
      parkState.vanguard = true;
      io.emit("server_message", { type: "park_state", parked: true });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
