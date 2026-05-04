const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let vanguardSocket = null;

io.on("connection", (socket)=>{
  console.log("client connected", socket.id);

  socket.on("identify",(data)=>{
    if(data.role==="vanguard"){ vanguardSocket=socket; }
  });

  socket.on("control",(msg)=>{
    if(vanguardSocket){ vanguardSocket.send(JSON.stringify(msg)); }
  });

  socket.on("message",(m)=>{
    try{
      const obj=JSON.parse(m);
      if(obj.type==="telemetry"){ io.emit("telemetry",obj); }
    }catch(e){}
  });
});

server.listen(3000, ()=>console.log("Server running on port 3000"));
