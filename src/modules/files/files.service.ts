import { promises as fs } from 'fs';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { Repository } from 'typeorm';
import { PublicFile } from '../../entities/public-file.entity';

export const LOCAL_UPLOADS_DIR = join(process.cwd(), 'uploads');

type StorageDriver = 's3' | 'local';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly driver: StorageDriver;
  private readonly s3Client: S3Client | null;

  constructor(
    @InjectRepository(PublicFile)
    private readonly publicFileRepository: Repository<PublicFile>,
  ) {
    this.driver = process.env.STORAGE_DRIVER === 'local' ? 'local' : 's3';
    this.s3Client =
      this.driver === 's3'
        ? new S3Client({ region: process.env.AWS_REGION })
        : null;
  }

  // Writes the file to storage and returns an *unsaved* PublicFile: the row is
  // inserted by the owner's cascade save, in the same transaction as the owner.
  async uploadPublicFile(file: Express.Multer.File): Promise<PublicFile> {
    const key = this.buildKey(file.originalname);
    const url =
      this.driver === 'local'
        ? await this.saveLocally(key, file)
        : await this.uploadToS3(key, file);

    return this.publicFileRepository.create({
      key,
      url,
      mimeType: file.mimetype,
      size: file.size,
    });
  }

  // All or nothing: if any upload fails, the ones that succeeded are removed
  // from storage before the error is rethrown.
  async uploadManyPublicFiles(
    files: Express.Multer.File[] | undefined,
  ): Promise<PublicFile[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(
      files.map((file) => this.uploadPublicFile(file)),
    );
    const uploaded = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    const failed = results.find((r) => r.status === 'rejected');

    if (failed) {
      await this.deleteStoredFiles(uploaded);
      throw failed.reason;
    }

    return uploaded;
  }

  // Removes files from storage only (no DB rows involved) — the rollback for
  // uploads whose owner was never saved. Best effort: a failure is logged and
  // must not mask the error that caused the rollback.
  async deleteStoredFiles(files: PublicFile[]): Promise<void> {
    await Promise.all(
      files.map((file) =>
        this.deleteFromStorage(file.key).catch((error: unknown) =>
          this.logger.warn(
            `Failed to delete orphaned upload "${file.key}": ${String(error)}`,
          ),
        ),
      ),
    );
  }

  async deletePublicFile(id: string): Promise<void> {
    const publicFile = await this.publicFileRepository.findOne({
      where: { id },
    });

    if (!publicFile) {
      return;
    }

    await this.deleteFromStorage(publicFile.key);
    await this.publicFileRepository.remove(publicFile);
  }

  private async deleteFromStorage(key: string): Promise<void> {
    if (this.driver === 'local') {
      await fs.unlink(join(LOCAL_UPLOADS_DIR, key)).catch(() => undefined);
    } else {
      await this.s3Client!.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: key,
        }),
      );
    }
  }

  private buildKey(originalName: string): string {
    const sanitized = originalName
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9.\-_]/g, '');

    return `${uuidv4()}-${sanitized}`;
  }

  private async uploadToS3(
    key: string,
    file: Express.Multer.File,
  ): Promise<string> {
    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return `${process.env.CLOUDFRONT_DOMAIN}/${key}`;
  }

  private async saveLocally(
    key: string,
    file: Express.Multer.File,
  ): Promise<string> {
    await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(LOCAL_UPLOADS_DIR, key), file.buffer);

    return `http://localhost:${process.env.PORT ?? 3000}/uploads/${key}`;
  }
}
