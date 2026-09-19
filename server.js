const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/', (req, res) => res.send('PrintHub Cloud Relay is running!'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Список онлайн-вкладок
const users = new Map(); // socketId -> { id, name }
const pendingJobs = new Map();

io.on('connection', (socket) => {
  // Пользователь просто открыл сайт
  socket.on('user:join', (data) => {
    users.set(socket.id, {
      id: socket.id,
      name: data.name || `Пользователь_${socket.id.slice(0, 4)}`
    });
    io.emit('users:update', Array.from(users.values()));
  });

  // Отправка задания (в рулетку или другу)
  socket.on('job:send', (job, callback) => {
    let targetSocketId = job.targetId;

    if (job.mode === 'roulette' || job.mode === 'fax') {
      const candidates = Array.from(users.values()).filter(u => u.id !== socket.id);
      if (candidates.length === 0) {
        return callback({ error: 'Сейчас нет других участников онлайн!' });
      }
      targetSocketId = candidates[Math.floor(Math.random() * candidates.length)].id;
    }

    if (!targetSocketId || !users.has(targetSocketId)) {
      return callback({ error: 'Получатель не найден или вышел' });
    }

    const jobId = `job_${uuidv4().slice(0, 8)}`;
    pendingJobs.set(jobId, {
      id: jobId,
      senderSocketId: socket.id,
      targetSocketId: targetSocketId,
      content: job.content
    });

    // Отправляем СЛЕПОЕ уведомление во вкладку получателя
    io.to(targetSocketId).emit('job:incoming', { id: jobId });
    callback({ success: true, jobId });
  });

  // Получатель нажал «Печатать!» в браузере
  socket.on('job:accept', (jobId) => {
    const job = pendingJobs.get(jobId);
    if (!job) return;

    // Шлём контент прямо в браузер получателя для вызова window.print()
    io.to(job.targetSocketId).emit('job:trigger_print', {
      content: job.content
    });

    pendingJobs.delete(jobId);
  });

  socket.on('job:decline', (jobId) => {
    pendingJobs.delete(jobId);
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('users:update', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Relay active on ${PORT}`));
