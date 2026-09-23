import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: '/posts/1' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const filter = new AllExceptionsFilter();

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('keeps HttpException status, message and error', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('Post not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Post not found',
      error: 'Not Found',
      timestamp: expect.any(String),
      path: '/posts/1',
    });
  });

  it('hides the message of unexpected errors in production', () => {
    process.env.NODE_ENV = 'production';
    const { host, status, json } = createHost();

    filter.catch(new Error('relation "post" does not exist'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(body)).not.toMatch(/relation|at .*\.ts/);
  });

  it('shows the message, but never the stack, outside production', () => {
    process.env.NODE_ENV = 'development';
    const { host, json } = createHost();

    filter.catch(new Error('boom'), host);

    const body = json.mock.calls[0][0];
    expect(body.message).toBe('boom');
    expect(body).not.toHaveProperty('stack');
  });
});
