import type { FastifyPluginAsync } from 'fastify';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { clientRoutes } from './client.js';
import { downloadRoutes } from './downloads.js';
import { libraryRoutes } from './library.js';
import { manageRoutes } from './manage.js';
import { meRoutes } from './me.js';
import { storeRoutes } from './store.js';
import { systemRoutes } from './system.js';
import { uploadRoutes } from './uploads.js';
import { wsRoutes } from './ws.js';

export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(systemRoutes);
  await app.register(wsRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(storeRoutes, { prefix: '/store' });
  await app.register(libraryRoutes, { prefix: '/library' });
  await app.register(uploadRoutes, { prefix: '/uploads' });
  await app.register(downloadRoutes, { prefix: '/builds' });
  await app.register(manageRoutes, { prefix: '/manage' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(clientRoutes);
  app.get('/openapi.json', { schema: { hide: true }, config: { allowInMaintenance: true } }, async () => app.swagger());
};
