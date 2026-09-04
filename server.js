const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(__dirname));

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 6; i++) value += chars[Math.floor(Math.random() * chars.length)];
  return value;
}
function cleanField(field) {
  if (!Array.isArray(field)) return [];
  return JSON.parse(JSON.stringify(field.slice(0, 3)));
}
function view(room, socketId) {
  const me = room.players.find(p => p.id === socketId);
  const other = room.players.find(p => p.id !== socketId);
  return {
    roomCode: room.code,
    started: room.started,
    playerNumber: room.players.indexOf(me) + 1,
    myName: me?.name || '플레이어',
    opponentName: other?.name || '상대 대기 중',
    myField: me?.field || [],
    opponentField: other?.field || [],
    isMyTurn: room.started && room.turn === socketId,
    playerCount: room.players.length
  };
}
function broadcast(room) {
  room.players.forEach(player => io.to(player.id).emit('room:state', view(room, player.id)));
}
function leaveRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode || !rooms.has(roomCode)) return;
  const room = rooms.get(roomCode);
  room.players = room.players.filter(p => p.id !== socket.id);
  if (!room.players.length) rooms.delete(roomCode);
  else {
    room.started = false;
    room.turn = null;
    room.players.forEach(p => p.ready = false);
    broadcast(room);
    io.to(room.code).emit('room:notice', '상대가 나갔습니다. 새 상대를 기다립니다.');
  }
  socket.leave(roomCode);
  socket.data.roomCode = null;
}

io.on('connection', socket => {
  socket.on('room:create', ({ name }, ack = () => {}) => {
    leaveRoom(socket);
    let roomCode;
    do roomCode = code(); while (rooms.has(roomCode));
    const room = { code: roomCode, players: [], started: false, turn: null };
    rooms.set(roomCode, room);
    room.players.push({ id: socket.id, name: String(name || '플레이어').slice(0, 20), field: [], ready: false });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    ack({ ok: true, roomCode });
    broadcast(room);
  });

  socket.on('room:join', ({ roomCode, name }, ack = () => {}) => {
    const key = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(key);
    if (!room) return ack({ ok: false, message: '존재하지 않는 방입니다.' });
    if (room.players.length >= 2) return ack({ ok: false, message: '방이 가득 찼습니다.' });
    leaveRoom(socket);
    room.players.push({ id: socket.id, name: String(name || '플레이어').slice(0, 20), field: [], ready: false });
    socket.join(key);
    socket.data.roomCode = key;
    ack({ ok: true, roomCode: key });
    broadcast(room);
  });

  socket.on('battle:ready', ({ field }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.started) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.field = cleanField(field);
    player.ready = player.field.length > 0;
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.started = true;
      room.turn = room.players[Math.floor(Math.random() * 2)].id;
      io.to(room.code).emit('battle:started');
    }
    broadcast(room);
  });

  socket.on('battle:commit', ({ myField, opponentField, endTurn }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.turn !== socket.id) return;
    const me = room.players.find(p => p.id === socket.id);
    const other = room.players.find(p => p.id !== socket.id);
    if (!me || !other) return;
    me.field = cleanField(myField);
    other.field = cleanField(opponentField);
    if (endTurn) room.turn = other.id;
    broadcast(room);
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game server: http://localhost:${PORT}`));
