import { Controller, Post, UploadedFile, UseInterceptors, INestApplication } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { memoryStorage } from 'multer';
import request from 'supertest';

// The same interceptor options as StockController.uploadImage, on a bare route:
// guards against a multer/platform-express upgrade breaking product-image uploads.
@Controller('t')
class UploadProbe {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return { name: file?.originalname, size: file?.size, mime: file?.mimetype };
  }
}

describe('image upload (multer)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [UploadProbe] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('accepts a small image and exposes its bytes in memory', async () => {
    const res = await request(app.getHttpServer()).post('/t/upload').attach('file', Buffer.alloc(1000, 1), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'a.png', size: 1000, mime: 'image/png' });
  });

  it('rejects a file above the 2 Mo limit', async () => {
    const res = await request(app.getHttpServer()).post('/t/upload').attach('file', Buffer.alloc(3 * 1024 * 1024, 1), { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });
});
