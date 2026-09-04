const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(__dirname + '/index.html'));

const clone = value => JSON.parse(JSON.stringify(value));
const roomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
function stateFor(room, id) {
  const me = room.players.find(p => p.id === id);
  const enemy = room.players.find(p => p.id !== id);
  return { code: room.code, count: room.players.length, started: room.started,
    myField: clone(me?.field || []), opponentField: clone(enemy?.field || []),
    myTurn: room.turn === id, opponentName: enemy?.name || '상대 대기 중' };
}
function sync(room) { room.players.forEach(p => io.to(p.id).emit('battle:state', stateFor(room, p.id))); }
function leave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  if (!room.players.length) rooms.delete(room.code);
  else { room.started = false; room.turn = null; room.players.forEach(p => p.ready = false); sync(room); }
  socket.leave(room.code); socket.data.room = null;
}
io.on('connection', socket => {
  socket.on('room:create', ({ name }, ack) => {
    leave(socket); let code; do code = roomCode(); while (rooms.has(code));
    const room = { code, players: [{ id: socket.id, name, field: [], ready: false }], started: false, turn: null };
    rooms.set(code, room); socket.join(code); socket.data.room = code; ack({ ok: true, code }); sync(room);
  });
  socket.on('room:join', ({ code, name }, ack) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.players.length >= 2) return ack({ ok: false, message: '방이 없거나 가득 찼습니다.' });
    leave(socket); room.players.push({ id: socket.id, name, field: [], ready: false });
    socket.join(room.code); socket.data.room = room.code; ack({ ok: true, code: room.code }); sync(room);
  });
  socket.on('battle:ready', ({ field }) => {
    const room = rooms.get(socket.data.room); if (!room) return;
    const me = room.players.find(p => p.id === socket.id); if (!me) return;
    me.field = clone((field || []).slice(0, 3)); me.ready = me.field.length > 0;
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.started = true;
      // 매 경기마다 서버가 선공/후공을 무작위로 결정합니다.
      room.turn = room.players[Math.floor(Math.random() * room.players.length)].id;
    }
    sync(room);
  });
  socket.on('battle:motion', motion => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.started || room.turn !== socket.id) return;
    socket.to(room.code).emit('battle:motion', clone(motion));
  });
  socket.on('battle:commit', ({ myField, opponentField }) => {
    const room = rooms.get(socket.data.room); if (!room || room.turn !== socket.id) return;
    const me = room.players.find(p => p.id === socket.id), enemy = room.players.find(p => p.id !== socket.id);
    if (!me || !enemy) return;
    me.field = clone((myField || []).slice(0, 3)); enemy.field = clone((opponentField || []).slice(0, 3));
    room.turn = enemy.id; sync(room);
  });
  socket.on('disconnect', () => leave(socket));
});
server.listen(process.env.PORT || 3000, () => console.log('Game server running'));
