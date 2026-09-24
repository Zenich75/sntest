import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicFile } from '../../entities/public-file.entity';
import { FilesService } from './files.service';

function multerFile(originalname: string): Express.Multer.File {
  return {
    originalname,
    mimetype: 'image/jpeg',
    size: 3,
    buffer: Buffer.from('abc'),
  } as Express.Multer.File;
}

// The private storage methods the tests stub out.
interface StorageInternals {
  saveLocally(key: string, file: Express.Multer.File): Promise<string>;
  deleteFromStorage(key: string): Promise<void>;
}

describe('FilesService', () => {
  const originalDriver = process.env.STORAGE_DRIVER;
  let service: FilesService;
  let repository: { create: jest.Mock; save: jest.Mock };
  let saveLocally: jest.SpiedFunction<StorageInternals['saveLocally']>;
  let deleteFromStorage: jest.SpiedFunction<
    StorageInternals['deleteFromStorage']
  >;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    process.env.STORAGE_DRIVER = 'local';
    repository = {
      create: jest.fn((data: Partial<PublicFile>) => ({ ...data })),
      save: jest.fn(),
    };
    service = new FilesService(repository as unknown as Repository<PublicFile>);
    // Storage itself is stubbed: these tests are about what gets written
    // and rolled back, not about the disk.
    const storage = service as unknown as StorageInternals;
    saveLocally = jest
      .spyOn(storage, 'saveLocally')
      .mockImplementation((key: string) => Promise.resolve(`/uploads/${key}`));
    deleteFromStorage = jest
      .spyOn(storage, 'deleteFromStorage')
      .mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env.STORAGE_DRIVER = originalDriver;
  });

  it('returns unsaved entities and never inserts rows itself', async () => {
    const files = await service.uploadManyPublicFiles([
      multerFile('a.jpg'),
      multerFile('b c.jpg'),
    ]);

    expect(files).toHaveLength(2);
    expect(files[1].key).toMatch(/-b-c\.jpg$/);
    expect(files[1].url).toBe(`/uploads/${files[1].key}`);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('removes already stored files when one of the uploads fails', async () => {
    const failure = new Error('disk full');
    saveLocally.mockImplementation((key: string) =>
      key.endsWith('-bad.jpg')
        ? Promise.reject(failure)
        : Promise.resolve(`/uploads/${key}`),
    );

    await expect(
      service.uploadManyPublicFiles([
        multerFile('ok1.jpg'),
        multerFile('bad.jpg'),
        multerFile('ok2.jpg'),
      ]),
    ).rejects.toBe(failure);

    const deletedKeys = deleteFromStorage.mock.calls.map(([key]) => key);
    expect(deletedKeys).toHaveLength(2);
    expect(deletedKeys.every((key) => /-ok[12]\.jpg$/.test(key))).toBe(true);
  });

  it('deleteStoredFiles does not throw when storage deletion fails', async () => {
    deleteFromStorage.mockRejectedValue(new Error('S3 down'));

    await expect(
      service.deleteStoredFiles([{ key: 'k1' } as PublicFile]),
    ).resolves.toBeUndefined();
  });
});
