# File uploads — S3/CloudFront setup & local dev fallback

`FilesService` uploads through one of two drivers, selected by `STORAGE_DRIVER`:

- `s3` (default) — real AWS S3 + CloudFront, needs the AWS variables below.
- `local` — saves to `./uploads` and serves it at `/uploads` via `ServeStaticModule`.
  No AWS account needed; this is what `.env` is set to out of the box, since this
  repo has no real AWS credentials configured.

Both drivers implement the same `FilesService` interface
(`uploadPublicFile` / `uploadManyPublicFiles` / `deletePublicFile`), so nothing
downstream (e.g. the Posts module) needs to know which one is active.

## Setting up a real S3 bucket + CloudFront for local dev

- Create an S3 bucket (any region), block all public access — CloudFront will
  be the only public entry point.
- Create a CloudFront distribution with the bucket as its origin:
  - Use an Origin Access Control (OAC) so the bucket stays private and only
    CloudFront can read from it.
  - Update the bucket policy to allow `s3:GetObject` from that OAC.
- Create an IAM user (or role) with a policy scoped to that one bucket:
  `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject` on `arn:aws:s3:::<bucket>/*`.
- Generate an access key for that user and fill in `.env`:
  ```
  STORAGE_DRIVER=s3
  AWS_REGION=<bucket region>
  AWS_ACCESS_KEY_ID=<key>
  AWS_SECRET_ACCESS_KEY=<secret>
  AWS_S3_BUCKET=<bucket name>
  CLOUDFRONT_DOMAIN=https://<distribution-id>.cloudfront.net
  ```
- CORS on the bucket isn't required for this flow (uploads go server → S3, not
  browser → S3), but add it later if direct browser uploads are introduced.

## No AWS account yet? Use the local driver

```
STORAGE_DRIVER=local
```

Files are written to `./uploads/<uuid>-<sanitized-original-name>` and served
back at `http://localhost:<PORT>/uploads/<key>`. The `uploads/` directory is
gitignored — it's created automatically on first upload. Under `docker compose` the
directory lives in the `uploads_data` named volume (mounted at `/usr/src/app/uploads`), so
files survive container recreation; `docker compose down -v` deletes them.

## Upload limits and manual test checklist

Uploads go through `POST /posts` (multipart, form field `files`, optional `text`). All
limits are enforced by `FileSizeValidationPipe`, so every violation is a `400` in the
common error format:

- up to 10 files per post — `"Максимум 10 файлів на пост"`;
- images (`image/jpeg`, `image/png`, `image/webp`) up to 2 MB, videos (`video/mp4`,
  `video/quicktime`, `video/webm`) up to 16 MB;
- the real type is detected from the file's magic bytes (`file-type`) and must match
  the declared `Content-Type` — otherwise `"Файл \"…\" не відповідає заявленому типу"`.

`file-type` is ESM-only; how it is loaded in the CommonJS build and in Jest is described
in the README ("ESM-зависимости").

`FilesUploadInterceptor` (`src/common/interceptors`) keeps multer's own hard ceilings
(20 MB per file, 11 files) only to cap memory; hitting them also returns a `400`, never
multer's `413`.

With `STORAGE_DRIVER=local`, log in first (see `AUTH.md`), then:

```bash
curl -b cookies.txt -X POST http://localhost:3000/posts \
  -F "text=Hello" \
  -F "files=@/path/to/photo.jpg" \
  -F "files=@/path/to/clip.mp4"
```

- Confirm each returned `files[].url` opens in a browser.
- An image over 2 MB, a video over 16 MB, 11+ files, an unsupported type, or a file
  whose content doesn't match its `Content-Type` (e.g. an `.exe` sent as `image/jpeg`)
  all give `400`. These cases are also covered by `test/hardening.e2e-spec.ts`.
