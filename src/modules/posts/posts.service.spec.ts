import { Repository } from 'typeorm';
import { Post } from '../../entities/post.entity';
import { PublicFile } from '../../entities/public-file.entity';
import { User } from '../../entities/user.entity';
import { FilesService } from '../files/files.service';
import { PostsService } from './posts.service';

describe('PostsService.create', () => {
  const author = { id: 'user-1' } as User;
  const upload = [{ originalname: 'a.jpg' }] as Express.Multer.File[];
  const storedFiles = [{ key: 'uuid-a.jpg' }] as PublicFile[];

  let repository: { create: jest.Mock; save: jest.Mock };
  let filesService: {
    uploadManyPublicFiles: jest.Mock;
    deleteStoredFiles: jest.Mock;
  };
  let service: PostsService;

  beforeEach(() => {
    repository = {
      create: jest.fn((data: Partial<Post>) => ({ ...data })),
      save: jest.fn((post: Post) => Promise.resolve({ ...post, id: 'post-1' })),
    };
    filesService = {
      uploadManyPublicFiles: jest.fn().mockResolvedValue(storedFiles),
      deleteStoredFiles: jest.fn().mockResolvedValue(undefined),
    };
    service = new PostsService(
      repository as unknown as Repository<Post>,
      filesService as unknown as FilesService,
    );
  });

  it('saves the post together with its files in one save call', async () => {
    const post = await service.create(author, { text: 'hi' }, upload);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ author, text: 'hi', files: storedFiles }),
    );
    expect(post.id).toBe('post-1');
    expect(filesService.deleteStoredFiles).not.toHaveBeenCalled();
  });

  it('removes stored files and rethrows when saving the post fails', async () => {
    const failure = new Error('connection lost');
    repository.save.mockRejectedValue(failure);

    await expect(service.create(author, { text: 'hi' }, upload)).rejects.toBe(
      failure,
    );
    expect(filesService.deleteStoredFiles).toHaveBeenCalledWith(storedFiles);
  });

  it('does not save the post when an upload fails', async () => {
    filesService.uploadManyPublicFiles.mockRejectedValue(new Error('S3 down'));

    await expect(service.create(author, {}, upload)).rejects.toThrow('S3 down');
    expect(repository.save).not.toHaveBeenCalled();
  });
});
