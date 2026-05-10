const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function makeRoom() {
  return {
    players: {},
    started: false,
    countdown: 0,
    readyCount: 0
  };
}

io.on('connection', (socket) => {
  let roomId = null;
  let playerNum = null;

  socket.on('joinRoom', (id) => {
    roomId = id || 'default';
    if (!rooms[roomId]) rooms[roomId] = makeRoom();
    const room = rooms[roomId];

    const taken = Object.values(room.players).map(p => p.num);
    playerNum = taken.includes(1) ? (taken.includes(2) ? null : 2) : 1;

    if (playerNum === null) {
      socket.emit('roomFull');
      return;
    }

    room.players[socket.id] = { num: playerNum, x: 340, y: playerNum === 1 ? 100 : 125, angle: -Math.PI / 2, speed: 0, laps: 0, progress: 0, finished: false };
    socket.join(roomId);
    socket.emit('welcome', { playerNum, roomId });
    io.to(roomId).emit('playerCount', Object.keys(room.players).length);
  });

  socket.on('input', (data) => {
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (!room.started) return;
    const player = room.players[socket.id];
    if (!player || player.finished) return;

    const ACCEL = 0.18, BRAKE = 0.14, TURN = 0.045, FRICTION = 0.97, MAX_SPEED = 5, OFF_FRICTION = 0.93;

    if (data.left) player.angle -= TURN * (player.speed / MAX_SPEED + 0.3);
    if (data.right) player.angle += TURN * (player.speed / MAX_SPEED + 0.3);
    if (data.accel) player.speed = Math.min(MAX_SPEED, player.speed + ACCEL);
    if (data.brake) player.speed = Math.max(0, player.speed - BRAKE);

    const onTrack = distToTrack(player.x, player.y) < 32;
    player.speed *= onTrack ? FRICTION : OFF_FRICTION;

    player.x = Math.max(10, Math.min(680 - 10, player.x + Math.cos(player.angle) * player.speed));
    player.y = Math.max(10, Math.min(480 - 10, player.y + Math.sin(player.angle) * player.speed));

    const prog = trackProgress(player.x, player.y);
    if (player.progress > 0.85 && prog < 0.15) player.laps++;
    if (player.laps >= 3 && !player.finished) {
      player.finished = true;
      io.to(roomId).emit('playerFinished', { num: player.num });
    }
    player.progress = prog;

    io.to(roomId).emit('state', buildState(room));
  });

  socket.on('ready', () => {
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.readyCount = (room.readyCount || 0) + 1;
    if (room.readyCount >= 2 && !room.started) {
      room.started = true;
      io.to(roomId).emit('raceStart');
    }
  });

  socket.on('disconnect', () => {
    if (!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[socket.id];
    io.to(roomId).emit('playerCount', Object.keys(rooms[roomId].players).length);
    if (Object.keys(rooms[roomId].players).length === 0) delete rooms[roomId];
  });
});

function buildState(room) {
  return Object.values(room.players).map(p => ({
    num: p.num, x: p.x, y: p.y, angle: p.angle, laps: p.laps, progress: p.progress, finished: p.finished
  }));
}

const trackCenters = [
  {x:340,y:80},{x:580,y:80},{x:630,y:140},{x:630,y:340},{x:580,y:400},
  {x:340,y:420},{x:200,y:380},{x:120,y:280},{x:120,y:180},{x:200,y:100}
];

function closestPointOnSegment(px,py,ax,ay,bx,by){
  let dx=bx-ax,dy=by-ay,t=((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy);
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

function distToTrack(x,y){
  let minD=Infinity;
  for(let i=0;i<trackCenters.length;i++){
    let a=trackCenters[i],b=trackCenters[(i+1)%trackCenters.length];
    let d=closestPointOnSegment(x,y,a.x,a.y,b.x,b.y);
    if(d<minD)minD=d;
  }
  return minD;
}

function trackProgress(x,y){
  let minD=Infinity,seg=-1,tBest=0;
  for(let i=0;i<trackCenters.length;i++){
    let a=trackCenters[i],b=trackCenters[(i+1)%trackCenters.length];
    let dx=b.x-a.x,dy=b.y-a.y,t=((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy);
    t=Math.max(0,Math.min(1,t));
    let d=Math.hypot(x-(a.x+t*dx),y-(a.y+t*dy));
    if(d<minD){minD=d;seg=i;tBest=t;}
  }
  return (seg+tBest)/trackCenters.length;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Space Racer running on port ' + PORT));
