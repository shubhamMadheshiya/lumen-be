import * as dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  mongoUri: optional('MONGO_URI', optional('MONGODB_URI', 'mongodb://lumen:lumen_dev_pass@localhost:27017/lumen?authSource=admin')),

  jwt: {
    accessSecret: optional('JWT_ACCESS_SECRET', 'dev_access_secret_at_least_32_chars!!'),
    refreshSecret: optional('JWT_REFRESH_SECRET', 'dev_refresh_secret_at_least_32_chars!!'),
    accessExpires: optional('JWT_ACCESS_EXPIRES', '15m'),
    refreshExpires: optional('JWT_REFRESH_EXPIRES', '30d'),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    region: optional('S3_REGION', 'us-east-1'),
    bucket: optional('S3_BUCKET', 'lumen-media'),
    accessKey: optional('S3_ACCESS_KEY', 'lumen_minio'),
    secretKey: optional('S3_SECRET_KEY', 'lumen_minio_pass'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'false') === 'true',
    mediaUrlExpirySeconds: parseInt(optional('MEDIA_URL_EXPIRY_SECONDS', '3600'), 10),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  google: {
    clientId:     optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
  },

  weatherApiKey: optional('WEATHER_API_KEY'),

  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',
} as const;
