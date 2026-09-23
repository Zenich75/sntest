import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { Observable } from 'rxjs';
import {
  IMAGE_MAX_SIZE,
  MAX_FILES_COUNT,
  VIDEO_MAX_SIZE,
} from '../pipes/file-size-validation.pipe';

const MB = 1024 * 1024;

// Files are buffered in memory, so multer keeps hard ceilings to cap RAM
// per request. They sit above the real limits (checked by
// FileSizeValidationPipe), so normally only the pipe rejects uploads.
const MULTER_MAX_FILE_SIZE = 20 * MB;
const MULTER_MAX_FILES = MAX_FILES_COUNT + 1;

export const UPLOAD_FIELD_NAME = 'files';

// Replaces Nest's FilesInterceptor, which turns multer errors into a 413 or
// a raw "Unexpected field" 400 before any filter sees them. Here every
// multer error becomes a 400 with the same wording the pipe uses.
@Injectable()
export class FilesUploadInterceptor implements NestInterceptor {
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MULTER_MAX_FILE_SIZE, files: MULTER_MAX_FILES },
  }).array(UPLOAD_FIELD_NAME);

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();

    await new Promise<void>((resolve, reject) => {
      this.upload(
        http.getRequest<Request>(),
        http.getResponse<Response>(),
        (error: unknown) => (error ? reject(toBadRequest(error)) : resolve()),
      );
    });

    return next.handle();
  }
}

function toBadRequest(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new BadRequestException(
          `Файл перевищує ліміт: ${IMAGE_MAX_SIZE / MB} МБ для зображень, ${VIDEO_MAX_SIZE / MB} МБ для відео`,
        );
      case 'LIMIT_FILE_COUNT':
        return new BadRequestException(
          `Максимум ${MAX_FILES_COUNT} файлів на пост`,
        );
      case 'LIMIT_UNEXPECTED_FILE':
        return new BadRequestException(
          `Файли потрібно передавати в полі "${UPLOAD_FIELD_NAME}"`,
        );
    }
  }

  // Anything else from the multipart parser (malformed body, missing
  // boundary, ...) is still the client's fault.
  return new BadRequestException(
    error instanceof Error ? error.message : 'Некоректне multipart-тіло запиту',
  );
}
