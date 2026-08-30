import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { CacheService } from './redis/cache.service';

export const getAuth = (
  prisma: PrismaClient,
  mailService: MailService,
  configService: ConfigService,
  cacheService: CacheService,
) => {
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
      get: (key) => cacheService.get(key),
      set: (key, value, ttl) => cacheService.set(key, value, ttl),
      delete: (key) => cacheService.delete(key),
      increment: async (key, ttl) => {
        const count = await cacheService.increment(key);
        if (count === 1) await cacheService.expire(key, ttl);
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
