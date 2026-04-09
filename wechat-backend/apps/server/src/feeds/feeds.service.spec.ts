import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@server/prisma/prisma.service';
import { TrpcService } from '@server/trpc/trpc.service';
import { FeedsService } from './feeds.service';

describe('FeedsService', () => {
  let service: FeedsService;
  const prismaService = {
    feed: {
      findMany: jest.fn(),
    },
  };
  const trpcService = {
    refreshMpArticlesAndUpdateFeed: jest.fn(),
  };
  const configService = {
    get: jest.fn(() => ({ updateDelayTime: 120, enableCleanHtml: false })),
  } as unknown as ConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedsService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: TrpcService,
          useValue: trpcService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<FeedsService>(FeedsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('updateFeed rethrows refresh failures to callers', async () => {
    trpcService.refreshMpArticlesAndUpdateFeed.mockRejectedValue(
      new Error('读书账号已失效，请重新扫码登录。'),
    );

    await expect(service.updateFeed('MP_WXS_1')).rejects.toThrow(
      '读书账号已失效，请重新扫码登录。',
    );
  });
});
