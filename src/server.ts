import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config/environment';
import { authRouter } from './routes/auth.routes';
import { userRouter } from './routes/user.routes';
import chatRouter from './routes/chat.routes';
import mediaRouter from './routes/media.routes';
import statusRouter from './routes/status.routes';
import cryptoRouter from './routes/crypto.routes';
import { errorHandler } from './middleware/error.middleware';
import { setupWebSocketGateway } from './websocket/ChatGateway';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static avatar uploads
app.use('/uploads', express.static(path.resolve(config.uploadDir)));

// Health check endpoint
app.get(['/api/health', '/health'], (_req, res) => {
  res.status(200).json({
    status: 'online',
    platform: 'MKD Messenger Platform',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API v1 Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/chats', chatRouter);
app.use('/api/v1/media', mediaRouter);
app.use('/api/v1/status', statusRouter);
app.use('/api/v1/crypto', cryptoRouter);

// Global Error Handler
app.use(errorHandler);

const server = http.createServer(app);

// Initialize WebSocket Gateway
setupWebSocketGateway(server);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 MKD Messenger Backend Server Started`);
  console.log(`📡 URL: http://localhost:${config.port}`);
  console.log(`🔌 WebSocket: ws://localhost:${config.port}/ws`);
  console.log(`🩺 Healthcheck: http://localhost:${config.port}/api/health`);
  console.log(`🛡️ Environment: ${config.nodeEnv}`);
  console.log(`======================================================\n`);
});

export { app, server };
