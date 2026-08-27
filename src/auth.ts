import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { RedisService } from './redis/redis.service';

export const getAuth = (
  prisma: PrismaClient,
  mailService: MailService,
  configService: ConfigService,
  redisService: RedisService,
) => {
  const redis = redisService.getClient();
  const googleClientId = configService.get<string>('GOOGLE_CLIENT_ID');
  const googleClientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
  const gitHubClientId = configService.get<string>('GITHUB_CLIENT_ID');
  const gitHubClientSecret = configService.get<string>('GITHUB_CLIENT_SECRET');

  const socialProviders: Record<
    string,
    {
      clientId: string;
      clientSecret: string;
      prompt?: string;
      mapProfileToUser?: (profile: {
        email?: string | null;
        id: number | string;
      }) => { email: string };
    }
  > = {};

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      prompt: 'select_account',
    };
  }

  if (gitHubClientId && gitHubClientSecret) {
    socialProviders.github = {
      clientId: gitHubClientId,
      clientSecret: gitHubClientSecret,
      mapProfileToUser: (profile) => ({
        email: profile.email ?? `${profile.id}@github.placeholder.local`,
      }),
    };
  }

  const auth = betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    baseURL: configService.get<string>(
      'BETTER_AUTH_URL',
      'http://localhost:4001',
    ),
    trustedOrigins: [configService.get<string>('FRONTEND_URL', 'http://localhost:3000')],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    secondaryStorage: {
      get: (key) => redis.get(key),
      set: async (key, value, ttl) => {
        if (ttl) await redis.set(key, value, 'EX', ttl);
        else await redis.set(key, value);
      },
      delete: async (key) => {
        await redis.del(key);
      },
      increment: async (key, ttl) => {
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, ttl);
        return count;
      },
    },
    rateLimit: {
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'USER',
          input: false,
        },
      },
    },
    socialProviders,
    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          if (type === 'email-verification' || type === 'sign-in') {
            await mailService.sendOtpEmail(email, otp);
          }
        },
      }),
    ],
  });

  return auth as unknown as ReturnType<typeof betterAuth>;
};
