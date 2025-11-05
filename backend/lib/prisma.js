// backend/lib/prisma.js
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

// Use a singleton in dev to avoid exhausting connections on hot-reload
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG?.split(',') ?? ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;