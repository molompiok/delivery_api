/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring ally package
  |----------------------------------------------------------
  */
  GOOGLE_CLIENT_ID: Env.schema.string(),
  GOOGLE_CLIENT_SECRET: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  BREVO_API_KEY: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for SMS Service
  |----------------------------------------------------------
  */
  SMS_SOURCE_NUMBER: Env.schema.string(),
  SMS_API_URL: Env.schema.string(),
  SMS_API_KEY: Env.schema.string(),

  VALHALLA_URL: Env.schema.string.optional(),
  VROOM_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Redis
  |----------------------------------------------------------
  */
  REDIS_HOST: Env.schema.string({ format: 'host' }),
  REDIS_PORT: Env.schema.number(),
  REDIS_PASSWORD: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Firebase
  |----------------------------------------------------------
  */
  FIREBASE_TYPE: Env.schema.string(),
  FIREBASE_PROJECT_ID: Env.schema.string(),
  FIREBASE_PRIVATE_KEY_ID: Env.schema.string(),
  FIREBASE_PRIVATE_KEY: Env.schema.string(),
  FIREBASE_CLIENT_EMAIL: Env.schema.string(),
  FIREBASE_CLIENT_ID: Env.schema.string(),
  FIREBASE_AUTH_URI: Env.schema.string(),
  FIREBASE_TOKEN_URI: Env.schema.string(),
  FIREBASE_AUTH_PROVIDER_X509_CERT_URL: Env.schema.string(),
  FIREBASE_CLIENT_X509_CERT_URL: Env.schema.string(),
  FIREBASE_UNIVERSE_DOMAIN: Env.schema.string(),

  // Android channels and sounds
  ANDROID_HIGH_PRIORITY_CHANNEL_ID: Env.schema.string.optional(),
  ANDROID_DEFAULT_CHANNEL_ID: Env.schema.string.optional(),
  FCM_OFFER_SOUND_ANDROID: Env.schema.string.optional(),
  FCM_DEFAULT_SOUND_ANDROID: Env.schema.string.optional(),
  FCM_OFFER_SOUND_IOS: Env.schema.string.optional(),
  FCM_DEFAULT_SOUND_IOS: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Wave API (wallet bridge)
  |----------------------------------------------------------
  */
  WAVE_API_URL: Env.schema.string.optional(),
  WAVE_API_KEY: Env.schema.string.optional(),
  WAVE_MANAGER_ID: Env.schema.string.optional(),
})
