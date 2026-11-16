import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

interface AccessPayload {
  sub: string;
  type: 'access';
  authMethod?: 'google' | 'password';
}

let ioInstance: SocketIOServer | null = null;

export function initSocketService(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : null) ||
        socket.handshake.query?.token;

      if (!token || typeof token !== 'string') {
        // Allow unauthenticated connection or mark anonymous
        return next();
      }

      try {
        const payload = jwt.verify(token, config.jwt.accessSecret) as AccessPayload;
        if (payload && payload.sub) {
          socket.userId = payload.sub;
        }
      } catch {
        // Invalid token - still allow connection for public reads, but socket.userId undefined
      }

      next();
    } catch (err: any) {
      next(err);
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    // Join / Leave channel room
    socket.on('join_channel', (data: { channelId: string }) => {
      if (data?.channelId) {
        socket.join(`channel:${data.channelId}`);
      }
    });

    socket.on('leave_channel', (data: { channelId: string }) => {
      if (data?.channelId) {
        socket.leave(`channel:${data.channelId}`);
      }
    });

    // Live typing indicator
    socket.on('typing_start', (data: { channelId: string; displayName?: string }) => {
      if (data?.channelId) {
        socket.to(`channel:${data.channelId}`).emit('user_typing', {
          channelId: data.channelId,
          userId: userId || 'anon',
          displayName: data.displayName || 'Someone',
          isTyping: true,
        });
      }
    });

    socket.on('typing_stop', (data: { channelId: string }) => {
      if (data?.channelId) {
        socket.to(`channel:${data.channelId}`).emit('user_typing', {
          channelId: data.channelId,
          userId: userId || 'anon',
          isTyping: false,
        });
      }
    });

    socket.on('disconnect', () => {
      // Automatic cleanup handled by socket.io rooms
    });
  });

  ioInstance = io;
  return io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function broadcastMessageCreated(channelId: string, message: any, dmUserIds?: string[]): void {
  if (!ioInstance) return;
  ioInstance.to(`channel:${channelId}`).emit('message_created', {
    channelId,
    message,
  });

  if (dmUserIds && Array.isArray(dmUserIds)) {
    for (const uid of dmUserIds) {
      ioInstance.to(`user:${uid}`).emit('message_created', {
        channelId,
        message,
      });
    }
  }
}

export function broadcastMessageUpdated(channelId: string, message: any): void {
  if (!ioInstance) return;
  ioInstance.to(`channel:${channelId}`).emit('message_updated', {
    channelId,
    message,
  });
}

export function broadcastMessageDeleted(channelId: string, messageId: string): void {
  if (!ioInstance) return;
  ioInstance.to(`channel:${channelId}`).emit('message_deleted', {
    channelId,
    messageId,
  });
}

export function broadcastReactionUpdated(
  channelId: string,
  payload: {
    messageId: string;
    reactions: Record<string, number>;
    userReactions?: string[];
  }
): void {
  if (!ioInstance) return;
  ioInstance.to(`channel:${channelId}`).emit('reaction_updated', {
    channelId,
    ...payload,
  });
}

export function broadcastPinsUpdated(channelId: string, pins: any[]): void {
  if (!ioInstance) return;
  ioInstance.to(`channel:${channelId}`).emit('pins_updated', {
    channelId,
    pins,
  });
}

