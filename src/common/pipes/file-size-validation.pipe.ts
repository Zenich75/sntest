import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';

export const IMAGE_MAX_SIZE = 2 * 1024 * 1024; // 2 MB
export const VIDEO_MAX_SIZE = 16 * 1024 * 1024; // 16 MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
];
export const MAX_FILES_COUNT = 10;

// Single source of truth for upload limits: FilesUploadInterceptor only sets
// generous hard ceilings, so every violation below surfaces as the same 400.
@Injectable()
export class FileSizeValidationPipe implements PipeTransform<
  Express.Multer.File[]
> {
  async transform(
    files: Express.Multer.File[],
  ): Promise<Express.Multer.File[]> {
    if (!files || files.length === 0) {
      return files;
    }

    if (files.length > MAX_FILES_COUNT) {
      throw new BadRequestException(
        `Максимум ${MAX_FILES_COUNT} файлів на пост`,
      );
    }

    for (const file of files) {
      if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        if (file.size > IMAGE_MAX_SIZE) {
          throw new BadRequestException(
            `Файл "${file.originalname}" перевищує ліміт ${IMAGE_MAX_SIZE / (1024 * 1024)} МБ для зображень`,
          );
        }
      } else if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
        if (file.size > VIDEO_MAX_SIZE) {
          throw new BadRequestException(
            `Файл "${file.originalname}" перевищує ліміт ${VIDEO_MAX_SIZE / (1024 * 1024)} МБ для відео`,
          );
        }
      } else {
        throw new BadRequestException('Непідтримуваний тип файлу');
      }

      await this.assertContentMatchesMimetype(file);
    }

    return files;
  }

  // file.mimetype comes from the client's Content-Type and can be spoofed,
  // so the real type is detected from the file's magic bytes.
  private async assertContentMatchesMimetype(
    file: Express.Multer.File,
  ): Promise<void> {
    const detected = await fileTypeFromBuffer(file.buffer);

    if (detected?.mime !== file.mimetype) {
      throw new BadRequestException(
        `Файл "${file.originalname}" не відповідає заявленому типу`,
      );
    }
  }
}
