import { ConfigService } from '@nestjs/config';
import { statusMap } from '@server/constants';
import {
  ACCOUNT_COOLDOWN_MESSAGE,
  EMPTY_ARTICLES_RESPONSE_MESSAGE,
  ACCOUNT_LOGIN_EXPIRED_MESSAGE,
  NO_AVAILABLE_ACCOUNT_MESSAGE,
  TrpcService,
  resetBlockedAccountsForTest,
} from './trpc.service';

describe('TrpcService', () => {
  const prismaService = {
    account: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    article: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    feed: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'platform') {
        return { url: 'https://example.com' };
      }

      if (key === 'feed') {
        return { updateDelayTime: 120 };
      }

      if (key === 'database') {
        return { type: 'mysql' };
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  let service: TrpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    resetBlockedAccountsForTest();
    prismaService.article.findFirst.mockResolvedValue(null);
    prismaService.article.findMany.mockResolvedValue([]);
    prismaService.article.createMany.mockResolvedValue({ count: 0 });
    prismaService.article.deleteMany.mockResolvedValue({ count: 0 });
    prismaService.$transaction.mockImplementation((operations: unknown[]) =>
      Promise.all(operations as Promise<unknown>[]),
    );
    prismaService.feed.update.mockResolvedValue({});
    prismaService.feed.findMany.mockResolvedValue([]);
    service = new TrpcService(prismaService, configService);
  });

  it('blocks accounts on first 401 and marks them invalid', async () => {
    await expect(
      (service as any).handleAccountRequestFailure(
        '931871246',
        'Token 失效（WeReadError401）， -2041',
      ),
    ).rejects.toThrow(ACCOUNT_LOGIN_EXPIRED_MESSAGE);

    expect(prismaService.account.updateMany).toHaveBeenCalledWith({
      where: { id: '931871246' },
      data: { status: statusMap.INVALID },
    });
    expect(service.getBlockedAccountIds()).toEqual(['931871246']);
  });

  it('keeps 429 as temporary cooldown only', async () => {
    await expect(
      (service as any).handleAccountRequestFailure(
        '931871246',
        '请求过频（WeReadError429）',
      ),
    ).rejects.toThrow(ACCOUNT_COOLDOWN_MESSAGE);

    expect(prismaService.account.updateMany).not.toHaveBeenCalled();
    expect(service.getBlockedAccountIds()).toEqual(['931871246']);
  });

  it('returns stable no-account message when no enabled account remains', async () => {
    prismaService.account.findMany.mockResolvedValue([]);

    await expect((service as any).getAvailableAccount()).rejects.toThrow(
      NO_AVAILABLE_ACCOUNT_MESSAGE,
    );
  });

  it('excludes blocked accounts from later selections', async () => {
    prismaService.account.findMany.mockResolvedValue([
      { id: 'blocked', token: 'a', status: statusMap.ENABLE },
      { id: 'active', token: 'b', status: statusMap.ENABLE },
    ]);

    await expect(
      (service as any).handleAccountRequestFailure(
        'blocked',
        '请求过频（WeReadError429）',
      ),
    ).rejects.toThrow(ACCOUNT_COOLDOWN_MESSAGE);

    await expect((service as any).getAvailableAccount()).resolves.toMatchObject(
      {
        id: 'active',
      },
    );
  });

  it('treats an empty first-page refresh for an existing feed as a failure', async () => {
    prismaService.article.findFirst.mockResolvedValue({
      id: 'local-article',
      publishTime: 1775187654,
    });
    jest.spyOn(service, 'getMpArticles').mockResolvedValue([]);

    await expect(
      service.refreshMpArticlesAndUpdateFeed('MP_WXS_3204910472'),
    ).rejects.toThrow(EMPTY_ARTICLES_RESPONSE_MESSAGE);

    expect(prismaService.feed.update).not.toHaveBeenCalled();
  });

  it('merges album fallback articles without duplicating the same article under another id', async () => {
    jest.spyOn(service, 'getMpArticles').mockResolvedValue([
      {
        id: 'RHBzsOD58D7OEBF-T5s7kA',
        title: '2026-04-06 Daily Brief',
        picUrl: 'https://example.com/1.jpg',
        publishTime: 1775448451,
      },
    ]);
    jest
      .spyOn(service as any, 'getSupplementalAlbumArticles')
      .mockResolvedValue([
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=1&sn=first',
          title: '2026-04-06 Daily Brief',
          picUrl: 'https://example.com/1.jpg',
          publishTime: 1775448291,
        },
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=second',
          title: '2026-04-06 Deep Dive',
          picUrl: 'https://example.com/2.jpg',
          publishTime: 1775448330,
        },
      ]);
    prismaService.article.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.article.createMany.mockResolvedValue({ count: 2 });

    const result = await service.refreshMpArticlesAndUpdateFeed(
      'MP_WXS_3204910472',
    );

    expect(prismaService.article.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'RHBzsOD58D7OEBF-T5s7kA',
          mpId: 'MP_WXS_3204910472',
          picUrl: 'https://example.com/1.jpg',
          publishTime: 1775448451,
          title: '2026-04-06 Daily Brief',
        },
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=second',
          mpId: 'MP_WXS_3204910472',
          picUrl: 'https://example.com/2.jpg',
          publishTime: 1775448330,
          title: '2026-04-06 Deep Dive',
        },
      ],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({
      insertedCount: 2,
      requestedCount: 2,
      latestRemotePublishTime: 1775448451,
    });
  });

  it('falls back to public album sync when no WeRead account is available', async () => {
    jest
      .spyOn(service, 'getMpArticles')
      .mockRejectedValue(new Error(NO_AVAILABLE_ACCOUNT_MESSAGE));
    jest
      .spyOn(service as any, 'getSupplementalAlbumArticles')
      .mockResolvedValue([
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=second',
          title: '2026-04-06 Deep Dive',
          picUrl: 'https://example.com/2.jpg',
          publishTime: 1775437215,
        },
      ]);
    prismaService.article.findFirst.mockResolvedValue({
      id: 'RHBzsOD58D7OEBF-T5s7kA',
      publishTime: 1775437252,
    });
    prismaService.article.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.article.createMany.mockResolvedValue({ count: 1 });

    const result = await service.refreshMpArticlesAndUpdateFeed(
      'MP_WXS_3204910472',
    );

    expect(prismaService.article.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=second',
          mpId: 'MP_WXS_3204910472',
          picUrl: 'https://example.com/2.jpg',
          publishTime: 1775437215,
          title: '2026-04-06 Deep Dive',
        },
      ],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({
      insertedCount: 1,
      requestedCount: 1,
      latestRemotePublishTime: 1775437215,
    });
  });

  it('removes older duplicate records when the same article already exists under another id', async () => {
    jest.spyOn(service, 'getMpArticles').mockResolvedValue([
      {
        id: 'taJGyWbsvzgKg4CHUc4PaQ',
        title: '万物一理：Ryo Lu 的灵魂设计哲学',
        picUrl: 'https://example.com/1.jpg',
        publishTime: 1775362051,
      },
    ]);
    jest
      .spyOn(service as any, 'getSupplementalAlbumArticles')
      .mockResolvedValue([]);
    prismaService.article.findMany
      .mockResolvedValueOnce([{ id: 'taJGyWbsvzgKg4CHUc4PaQ' }])
      .mockResolvedValueOnce([
        {
          id: 'taJGyWbsvzgKg4CHUc4PaQ',
          title: '万物一理：Ryo Lu 的灵魂设计哲学',
          publishTime: 1775362051,
        },
        {
          id: 's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505089&idx=1&sn=b05f62daff565060441d1e9451090fb4',
          title: '万物一理：Ryo Lu 的灵魂设计哲学',
          publishTime: 1775361891,
        },
      ]);
    prismaService.article.deleteMany.mockResolvedValue({ count: 1 });

    await service.refreshMpArticlesAndUpdateFeed('MP_WXS_3204910472');

    expect(prismaService.article.deleteMany).toHaveBeenCalledWith({
      where: {
        mpId: 'MP_WXS_3204910472',
        id: {
          in: [
            's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505089&idx=1&sn=b05f62daff565060441d1e9451090fb4',
          ],
        },
      },
    });
  });
});
