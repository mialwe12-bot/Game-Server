import type { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, forbidden } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { canUpload } from '../services/access.js';
import { uploadDto } from '../services/dto.js';

const idParams = z.object({ id: z.string() });

export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  const uploader = (req: Parameters<typeof requireAuth>[0]) => {
    const auth = requireAuth(req);
    if (!canUpload(auth.user)) throw forbidden('Nur Admins und Uploader dürfen hochladen');
    return auth.user;
  };

  app.post(
    '/',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Fortsetzbaren Upload anlegen (oder vorhandenen mit gleicher Datei fortsetzen)',
        body: z.object({
          buildId: z.string(),
          path: z.string().min(1).max(1024),
          size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          sha256: z
            .string()
            .regex(/^[a-fA-F0-9]{64}$/)
            .optional(),
        }),
      },
    },
    async (req) => {
      const user = uploader(req);
      const upload = await ctx.uploads.create(user, req.body);
      const settings = await ctx.settings.get();
      return { ...upload, chunkSize: settings.uploadChunkBytes };
    },
  );

  app.get('/', { schema: { tags: ['uploads'], summary: 'Eigene aktive Uploads' } }, async (req) => {
    const user = uploader(req);
    const list = await ctx.db.upload.findMany({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    return list.map(uploadDto);
  });

  app.get('/:id', { schema: { tags: ['uploads'], summary: 'Upload-Status/Offset', params: idParams } }, async (req, reply) => {
    const user = uploader(req);
    const upload = await ctx.uploads.get(user, req.params.id);
    reply.header('Upload-Offset', String(upload.offset));
    reply.header('Cache-Control', 'no-store');
    return uploadDto(upload);
  });

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Chunk anhängen (Content-Type: application/offset+octet-stream, Header Upload-Offset)',
        params: idParams,
        headers: z.object({ 'upload-offset': z.coerce.number().int().min(0) }).passthrough(),
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      const user = uploader(req);
      if (!req.headers['content-type']?.startsWith('application/offset+octet-stream')) {
        throw badRequest('Content-Type muss application/offset+octet-stream sein', 'invalid_content_type');
      }
      const upload = await ctx.uploads.append(user, req.params.id, req.headers['upload-offset'], req.body as Readable);
      reply.header('Upload-Offset', String(upload.offset));
      return uploadDto(upload);
    },
  );

  app.delete('/:id', { schema: { tags: ['uploads'], summary: 'Upload abbrechen', params: idParams } }, async (req) => {
    const user = uploader(req);
    await ctx.uploads.cancel(user, req.params.id);
    return { ok: true };
  });
};
