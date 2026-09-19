const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const printers = new Map(); // socketId -> { deviceId, model, status, ownerName }
const pendingJobs = new Map();

io.on('connection', (socket) => {
  // Агент сообщает о своем реальном принтере
  socket.on('agent:register', (data) => {
    printers.set(socket.id, {
      socketId: socket.id,
      deviceId: data.deviceId,
      model: data.model,
      status: data.status,
      name: "Мой принтер"
    });
    console.log(`[СИСТЕМА] Зарегистрирован принтер: ${data.model} [${data.status}]`);
    io.emit('printers:list', Array.from(printers.values()));
  });

  // Запрос списка подключенных принтеров
  socket.on('printers:get', () => {
    socket.emit('printers:list', Array.from(printers.values()));
  });

  // Отправка задания (Рулетка / Друг / Дейтинг)
  socket.on('job:send', (job, callback) => {
    const available = Array.from(printers.values()).filter(p => p.status === 'ready');

    if (available.length === 0) {
      return callback({ error: 'Нет активных принтеров онлайн. Включи agent.py!' });
    }

    let target = null;
    if (job.mode === 'friend' && job.targetDeviceId) {
      target = available.find(p => p.deviceId === job.targetDeviceId);
    } else {
      // Рулетка или Дейтинг: выбираем случайного участника
      target = available[Math.floor(Math.random() * available.length)];
    }

    if (!target) {
      return callback({ error: 'Выбранный получатель сейчас не в сети' });
    }

    const jobId = `job_${uuidv4().slice(0, 8)}`;
    pendingJobs.set(jobId, {
      id: jobId,
      senderSocketId: socket.id,
      targetSocketId: target.socketId,
      content: job.content,
      mode: job.mode
    });

    // СЛЕПОЙ ЗАПРОС получателю (без превью, без имени)
    io.to(target.socketId).emit('job:incoming', {
      id: jobId,
      mode: job.mode,
      pages: 1
    });

    callback({ success: true, jobId, targetName: target.name });
  });

  // Получатель нажал «Печатать»
  socket.on('job:accept', (jobId, callback) => {
    const job = pendingJobs.get(jobId);
    if (!job) return callback({ error: 'Задание не найдено' });

    // Отправляем в Python-агент на печать
    io.to(job.targetSocketId).emit('printer:exec', {
      jobId: job.id,
      content: job.content
    });

    pendingJobs.delete(jobId);
    callback({ success: true });
  });

  socket.on('job:decline', (jobId) => {
    pendingJobs.delete(jobId);
  });

  socket.on('disconnect', () => {
    if (printers.has(socket.id)) {
      printers.delete(socket.id);
      io.emit('printers:list', Array.from(printers.values()));
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[Бумага.Сеть] Сервер работает: http://localhost:${PORT}`);
});