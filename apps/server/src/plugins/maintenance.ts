import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/** Im Wartungsmodus sind nur Admins sowie explizit freigegebene Routen (Login, Status) erreichbar. */
export const maintenancePlugin = fp(async (app: FastifyInstance) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.routeOptions.config?.allowInMaintenance) return;
    const settings = await app.ctx.settings.get();
    if (!settings.maintenanceMode) return;
    if (req.auth?.user.role === 'ADMIN') return;
    reply.code(503).header('Retry-After', '300');
    return reply.send({ error: 'maintenance', message: settings.maintenanceMessage });
  });
});
