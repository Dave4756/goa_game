'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling']
});
const rooms = new Map();
let matchmakingSocketId = null;

app.disable('x-powered-by');
app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 6; i++) value += chars[Math.floor(Math.random() * chars.length)];
  return value;
}

function cloneCards(cards, limit = 3) {
  if (!Array.isArray(cards)) return [];
  return JSON.parse(JSON.stringify(cards.slice(0, limit)));
}

function view(room, socketId) {
  const me = room.players.find(player => player.id === socketId);
  const other = room.players.find(player => player.id !== socketId);
  return {
    roomCode: room.code,
    started: room.started,
    playerNumber: room.players.indexOf(me) + 1,
    myName: me?.name || '플레이어',
    opponentName: other?.name || '상대 대기 중',
    myField: me?.field || [],
    opponentField: other?.field || [],
    myTrash: me?.trash || [],
    opponentTrash: other?.trash || [],
    isMyTurn: room.started && room.turn === socketId,
    playerCount: room.players.length
  };
}

function broadcast(room) {
  room.players.forEach(player => {
    io.to(player.id).emit('room:state', view(room, player.id));
  });
}

function leaveRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode || !rooms.has(roomCode)) return;
  const room = rooms.get(roomCode);
  room.players = room.players.filter(player => player.id !== socket.id);
  if (!room.players.length) {
    rooms.delete(roomCode);
  } else {
    room.started = false;
    room.turn = null;
    room.players.forEach(player => { player.ready = false; });
    broadcast(room);
    io.to(room.code).emit('room:notice', '상대가 나갔습니다. 새 상대를 기다립니다.');
  }
  socket.leave(roomCode);
  socket.data.roomCode = null;
}

function addMatchedPlayer(room, socket, name) {
  room.players.push({
    id: socket.id,
    name: String(name || '플레이어').slice(0, 20),
    field: [],
    trash: [],
    ready: false
  });
  socket.join(room.code);
  socket.data.roomCode = room.code;
}

io.on('connection', socket => {
  socket.on('matchmaking:join', ({ name } = {}) => {
    leaveRoom(socket);
    if (matchmakingSocketId && matchmakingSocketId !== socket.id) {
      const waiting = io.sockets.sockets.get(matchmakingSocketId);
      if (waiting) {
        let roomCode;
        do roomCode = code(); while (rooms.has(roomCode));
        const room = { code: roomCode, players: [], started: false, turn: null };
        rooms.set(roomCode, room);
        addMatchedPlayer(room, waiting, waiting.data.matchmakingName || '플레이어');
        addMatchedPlayer(room, socket, name);
        matchmakingSocketId = null;
        waiting.data.matchmakingName = null;
        socket.data.matchmakingName = null;
        io.to(room.code).emit('matchmaking:matched', { roomCode });
        broadcast(room);
        return;
      }
      matchmakingSocketId = null;
    }
    matchmakingSocketId = socket.id;
    socket.data.matchmakingName = String(name || '플레이어').slice(0, 20);
    socket.emit('matchmaking:waiting');
  });

  socket.on('matchmaking:cancel', () => {
    if (matchmakingSocketId === socket.id) matchmakingSocketId = null;
    socket.data.matchmakingName = null;
  });

  socket.on('room:create', ({ name } = {}, ack = () => {}) => {
    leaveRoom(socket);
    let roomCode;
    do roomCode = code(); while (rooms.has(roomCode));
    const room = { code: roomCode, players: [], started: false, turn: null };
    rooms.set(roomCode, room);
    room.players.push({
      id: socket.id,
      name: String(name || '플레이어').slice(0, 20),
      field: [],
      trash: [],
      ready: false
    });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    ack({ ok: true, roomCode });
    broadcast(room);
  });

  socket.on('room:join', ({ roomCode, name } = {}, ack = () => {}) => {
    const key = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(key);
    if (!room) return ack({ ok: false, message: '존재하지 않는 방입니다.' });
    if (room.players.length >= 2) return ack({ ok: false, message: '방이 가득 찼습니다.' });
    leaveRoom(socket);
    room.players.push({
      id: socket.id,
      name: String(name || '플레이어').slice(0, 20),
      field: [],
      trash: [],
      ready: false
    });
    socket.join(key);
    socket.data.roomCode = key;
    ack({ ok: true, roomCode: key });
    broadcast(room);
  });

  socket.on('battle:deploy', ({ fieldIndex, card } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(item => item.id === socket.id);
    if (!room || !player || room.started || !card?.id) return;
    const index = Math.max(0, Math.min(2, Number(fieldIndex) || 0));
    player.field[index] = JSON.parse(JSON.stringify(card));
    player.field = player.field.filter(Boolean).slice(0, 3);
    broadcast(room);
  });

  socket.on('battle:ready', ({ field } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.started) return;
    const player = room.players.find(item => item.id === socket.id);
    if (!player) return;
    player.field = cloneCards(field, 3);
    player.ready = player.field.length > 0;
    if (room.players.length === 2 && room.players.every(item => item.ready)) {
      room.started = true;
      room.turn = room.players[Math.floor(Math.random() * 2)].id;
      io.to(room.code).emit('battle:started', { firstPlayerId: room.turn });
    }
    broadcast(room);
  });

  socket.on('battle:commit', ({ myField, opponentField, myTrash, opponentTrash, endTurn } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.turn !== socket.id) return;
    const me = room.players.find(item => item.id === socket.id);
    const other = room.players.find(item => item.id !== socket.id);
    if (!me || !other) return;
    me.field = cloneCards(myField, 3);
    other.field = cloneCards(opponentField, 3);
    me.trash = cloneCards(myTrash, 100);
    other.trash = cloneCards(opponentTrash, 100);
    if (endTurn) room.turn = other.id;
    broadcast(room);
  });

  socket.on('battle:fx', payload => {
    const roomCode = String(payload?.roomCode || socket.data.roomCode || '').trim().toUpperCase();
    const effect = payload?.effect;
    const allowed = new Set(['item', 'damage', 'awakening', 'draw', 'deploy', 'skill', 'skill-cast', 'evolution']);
    if (!roomCode || !effect || !allowed.has(effect.type)) return;
    if (socket.data.roomCode !== roomCode || !socket.rooms.has(roomCode)) return;
    socket.to(roomCode).emit('battle:fx', { effect });
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => {
    if (matchmakingSocketId === socket.id) matchmakingSocketId = null;
    leaveRoom(socket);
  });
});

const PORT = Number(process.env.PORT) || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server listening on 0.0.0.0:${PORT}`);
});
