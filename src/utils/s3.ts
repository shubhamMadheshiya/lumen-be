import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
});

/** Generate a pre-signed PUT URL for direct upload from the mobile client. */
export async function getUploadUrl(
  key: string,
  mimeType: string,
  expiresIn = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/** Generate a pre-signed GET URL to serve private media. */
export async function getDownloadUrl(
  key: string,
  expiresIn = config.s3.mediaUrlExpirySeconds,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/** Download an object's bytes on the server (used to show the member's own photos to Lumen AI). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty S3 object: ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}

/** Delete an object from the bucket. */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}
