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

    // Rooms are keyed by the channel's real id. Clients may name a channel by slug, so resolve it first,
    // and only let a signed-in member who may see the channel in.
    const resolveAllowed = async (raw: unknown): Promise<string | null> => {
      if (!userId || typeof raw !== 'string' || !raw) return null;
      try {
        const { loadChannel, canAccessChannel } = await import('../routes/communityChat');
        const channel = await loadChannel(raw);
        if (!channel || !(await canAccessChannel(userId, channel))) return null;
        return String(channel._id);
      } catch {
        return null;
      }
    };

    socket.on('join_channel', async (data: { channelId: string }) => {
      const id = await resolveAllowed(data?.channelId);
      if (id) socket.join(`channel:${id}`);
    });

    socket.on('leave_channel', async (data: { channelId: string }) => {
      const id = await resolveAllowed(data?.channelId);
      if (id) socket.leave(`channel:${id}`);
    });

    // Live typing indicator (only for rooms this socket has actually joined)
    socket.on('typing_start', async (data: { channelId: string; displayName?: string }) => {
      const id = await resolveAllowed(data?.channelId);
      if (!id || !socket.rooms.has(`channel:${id}`)) return;
      socket.to(`channel:${id}`).emit('user_typing', {
        channelId: id,
        userId: userId!,
        displayName: String(data.displayName || 'Someone').slice(0, 40),
        isTyping: true,
      });
    });

    socket.on('typing_stop', async (data: { channelId: string }) => {
      const id = await resolveAllowed(data?.channelId);
      if (!id || !socket.rooms.has(`channel:${id}`)) return;
      socket.to(`channel:${id}`).emit('user_typing', { channelId: id, userId: userId!, isTyping: false });
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

