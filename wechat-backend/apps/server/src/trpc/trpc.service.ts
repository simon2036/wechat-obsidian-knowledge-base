import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { defaultCount, statusMap } from '@server/constants';
import { PrismaService } from '@server/prisma/prisma.service';
import {
  buildWechatArticleUrl,
  normalizeWechatArticleId,
} from '@server/utils/wechat';
import { TRPCError, initTRPC } from '@trpc/server';
import Axios, { AxiosError, AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const ACCOUNT_LOGIN_EXPIRED_MESSAGE = '读书账号已失效，请重新扫码登录。';
export const ACCOUNT_COOLDOWN_MESSAGE =
  '当前读书账号请求过频，已进入临时冷却，请稍后再试。';
export const NO_AVAILABLE_ACCOUNT_MESSAGE =
  '暂无可用读书账号，请重新扫码登录。';

export const EMPTY_ARTICLES_RESPONSE_MESSAGE =
  'Refresh returned an empty first page for this feed. Please try again, or re-login if it keeps happening.';

type ArticleRecord = {
  id: string;
  title: string;
  picUrl: string;
  publishTime: number;
};

type RefreshFeedResult = {
  mpId: string;
  hasHistory: number;
  requestedCount: number;
  insertedCount: number;
  latestLocalPublishTime: number | null;
  latestRemotePublishTime: number | null;
};

type AlbumConfig = {
  albumId: string;
  biz: string;
};

type AlbumApiResponse = {
  base_resp?: { ret?: number };
  getalbum_resp?: {
    article_list?: Array<{
      cover_img_1_1?: string;
      create_time?: string;
      itemidx?: string;
      msgid?: string;
      title?: string;
      url?: string;
    }>;
    continue_flag?: string;
  };
};

const blockedAccountsMap = new Map<string, Set<string>>();

const WECHAT_PUBLIC_REQUEST_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'sec-ch-ua':
    '" Not A;Brand";v="99", "Chromium";v="101", "Google Chrome";v="101"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36',
} as const;

const ALBUM_DISCOVERY_SAMPLE_COUNT = 12;
const ALBUM_PAGE_SIZE = 10;
const ALBUM_MAX_PAGE_COUNT = 200;

export const resetBlockedAccountsForTest = () => {
  blockedAccountsMap.clear();
};

@Injectable()
export class TrpcService {
  trpc = initTRPC.create();
  publicProcedure = this.trpc.procedure;
  protectedProcedure = this.trpc.procedure.use(({ ctx, next }) => {
    const errorMsg = (ctx as any).errorMsg;
    if (errorMsg) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: errorMsg });
    }
    return next({ ctx });
  });
  router = this.trpc.router;
  mergeRouters = this.trpc.mergeRouters;
  request: AxiosInstance;
  updateDelayTime = 60;

  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const { url } =
      this.configService.get<ConfigurationType['platform']>('platform')!;
    this.updateDelayTime =
      this.configService.get<ConfigurationType['feed']>(
        'feed',
      )!.updateDelayTime;

    this.request = Axios.create({ baseURL: url, timeout: 15 * 1e3 });

    this.request.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<{ message?: string }>) => {
        const errMsg = this.getAxiosErrorMessage(error);
        const accountId = this.getRequestAccountId(error);

        if (errMsg) {
          try {
            await this.handleAccountRequestFailure(accountId, errMsg);
          } catch (handledError) {
            return Promise.reject(handledError);
          }
        }

        return Promise.reject(error);
      },
    );
  }

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  private getBlockedAccountSet() {
    const today = this.getTodayDate();
    const blockedAccounts = blockedAccountsMap.get(today);
    if (blockedAccounts) {
      return blockedAccounts;
    }

    const nextBlockedAccounts = new Set<string>();
    blockedAccountsMap.set(today, nextBlockedAccounts);
    return nextBlockedAccounts;
  }

  private getAxiosErrorMessage(error: AxiosError<{ message?: string }>) {
    if (typeof error.response?.data?.message === 'string') {
      return error.response.data.message;
    }

    return error.message || '';
  }

  private getRequestAccountId(error: AxiosError) {
    const headers =
      (error.config?.headers as Record<string, unknown> | undefined) || {};
    const accountId = headers.xid;
    return typeof accountId === 'string' ? accountId : undefined;
  }

  private blockAccount(accountId?: string) {
    if (!accountId) {
      return;
    }

    this.getBlockedAccountSet().add(accountId);
  }

  private async markAccountInvalid(accountId?: string) {
    if (!accountId) {
      return;
    }

    await this.prismaService.account.updateMany({
      where: { id: accountId },
      data: { status: statusMap.INVALID },
    });
  }

  private async handleAccountRequestFailure(
    accountId: string | undefined,
    errMsg: string,
  ) {
    if (errMsg.includes('WeReadError401')) {
      await this.markAccountInvalid(accountId);
      this.blockAccount(accountId);
      this.logger.error(`账号（${accountId || '-'}）登录失效，已禁用`);
      throw new Error(ACCOUNT_LOGIN_EXPIRED_MESSAGE);
    }

    if (errMsg.includes('WeReadError429')) {
      this.blockAccount(accountId);
      this.logger.error(`账号（${accountId || '-'}）请求过频，已进入临时冷却`);
      throw new Error(ACCOUNT_COOLDOWN_MESSAGE);
    }

    if (errMsg.includes('WeReadError400')) {
      this.logger.error(`账号（${accountId || '-'}）请求参数异常`);
      this.logger.error(`WeReadError400: ${errMsg}`);
      await new Promise((resolve) => setTimeout(resolve, 10 * 1e3));
      throw new Error('平台请求参数异常，请稍后再试。');
    }

    this.logger.error(`Unhandled platform error: ${errMsg}`);
    throw new Error(errMsg || '平台请求失败，请稍后再试。');
  }

  private shouldRetryGetMpArticles(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return ![NO_AVAILABLE_ACCOUNT_MESSAGE, ACCOUNT_COOLDOWN_MESSAGE].includes(
      message,
    );
  }

  private canFallbackToPublicAlbums(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return [
      NO_AVAILABLE_ACCOUNT_MESSAGE,
      ACCOUNT_COOLDOWN_MESSAGE,
      ACCOUNT_LOGIN_EXPIRED_MESSAGE,
    ].includes(message);
  }

  unblockAccount = (accountId: string) => {
    if (!accountId) {
      return;
    }

    this.getBlockedAccountSet().delete(accountId);
  };

  getBlockedAccountIds() {
    const disabledAccounts = Array.from(this.getBlockedAccountSet());
    this.logger.debug('disabledAccounts: ', disabledAccounts);
    return disabledAccounts.filter(Boolean);
  }

  private async getAvailableAccount() {
    const enabledAccounts = await this.prismaService.account.findMany({
      where: {
        status: statusMap.ENABLE,
      },
    });

    if (enabledAccounts.length === 0) {
      throw new Error(NO_AVAILABLE_ACCOUNT_MESSAGE);
    }

    const blockedAccountIds = new Set(this.getBlockedAccountIds());
    const availableAccounts = enabledAccounts.filter(
      ({ id }) => !blockedAccountIds.has(id),
    );

    if (availableAccounts.length === 0) {
      throw new Error(ACCOUNT_COOLDOWN_MESSAGE);
    }

    return availableAccounts[
      Math.floor(Math.random() * availableAccounts.length)
    ];
  }

  async getMpArticles(mpId: string, page = 1, retryCount = 3) {
    const account = await this.getAvailableAccount();

    try {
      const res = await this.request
        .get<ArticleRecord[]>(`/api/v2/platform/mps/${mpId}/articles`, {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
          params: {
            page,
          },
        })
        .then((res) => res.data)
        .then((res) => {
          this.logger.log(
            `getMpArticles(${mpId}) page: ${page} articles: ${res.length}`,
          );
          return res;
        });
      return res;
    } catch (err) {
      this.logger.error(`retry(${4 - retryCount}) getMpArticles  error: `, err);
      if (retryCount > 0 && this.shouldRetryGetMpArticles(err)) {
        return this.getMpArticles(mpId, page, retryCount - 1);
      }

      throw err;
    }
  }

  private normalizeArticleTitle(title: string) {
    return title.trim().replace(/\s+/g, ' ');
  }

  private isEquivalentArticle(
    left: Pick<ArticleRecord, 'publishTime' | 'title'>,
    right: Pick<ArticleRecord, 'publishTime' | 'title'>,
  ) {
    return (
      this.normalizeArticleTitle(left.title) ===
        this.normalizeArticleTitle(right.title) &&
      Math.abs(left.publishTime - right.publishTime) <= 300
    );
  }

  private mergeArticleSources(
    platformArticles: ArticleRecord[],
    supplementalArticles: ArticleRecord[],
  ) {
    const merged: ArticleRecord[] = [];

    const append = (article: ArticleRecord) => {
      if (!article.id || !article.title || !article.publishTime) {
        return;
      }

      if (
        !merged.some((existingArticle) =>
          this.isEquivalentArticle(existingArticle, article),
        )
      ) {
        merged.push(article);
      }
    };

    platformArticles.forEach(append);
    supplementalArticles.forEach(append);

    return merged.sort(
      (left, right) => right.publishTime - left.publishTime,
    );
  }

  private async fetchWechatText(url: string, referer?: string) {
    const response = await fetch(url, {
      headers: referer
        ? {
            ...WECHAT_PUBLIC_REQUEST_HEADERS,
            referer,
          }
        : WECHAT_PUBLIC_REQUEST_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    return response.text();
  }

  private extractAlbumConfigsFromHtml(html: string) {
    const sanitized = html.replace(/\\x26amp;|&amp;/g, '&');
    const albumConfigs = new Map<string, AlbumConfig>();
    const regex =
      /https?:\/\/mp\.weixin\.qq\.com\/mp\/appmsgalbum\?__biz=([^&"'\\\s]+).*?album_id=([0-9]+)/g;

    for (const match of sanitized.matchAll(regex)) {
      const biz = match[1];
      const albumId = match[2];
      if (!biz || !albumId) {
        continue;
      }

      albumConfigs.set(`${biz}:${albumId}`, { biz, albumId });
    }

    return Array.from(albumConfigs.values());
  }

  private async discoverAlbumConfigs(platformArticles: ArticleRecord[]) {
    const sampleArticles = platformArticles.slice(0, ALBUM_DISCOVERY_SAMPLE_COUNT);
    const discovered = new Map<string, AlbumConfig>();

    await Promise.allSettled(
      sampleArticles.map(async ({ id }) => {
        const url = buildWechatArticleUrl(id);
        const html = await this.fetchWechatText(url, url);

        this.extractAlbumConfigsFromHtml(html).forEach((config) => {
          discovered.set(`${config.biz}:${config.albumId}`, config);
        });
      }),
    );

    return Array.from(discovered.values());
  }

  private async getAlbumPageArticles(
    config: AlbumConfig,
    cursor?: { msgId: string; itemIdx: string },
  ) {
    const params = new URLSearchParams({
      action: 'getalbum',
      __biz: config.biz,
      album_id: config.albumId,
      count: String(ALBUM_PAGE_SIZE),
      f: 'json',
    });

    if (cursor?.msgId && cursor?.itemIdx) {
      params.set('begin_msgid', cursor.msgId);
      params.set('begin_itemidx', cursor.itemIdx);
    }

    const referer = `https://mp.weixin.qq.com/mp/appmsgalbum?__biz=${encodeURIComponent(
      config.biz,
    )}&action=getalbum&album_id=${config.albumId}#wechat_redirect`;
    const response = await fetch(
      `https://mp.weixin.qq.com/mp/appmsgalbum?${params.toString()}`,
      {
        headers: {
          ...WECHAT_PUBLIC_REQUEST_HEADERS,
          accept: 'application/json,text/plain,*/*',
          referer,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Album request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as AlbumApiResponse;
    if (payload.base_resp?.ret && payload.base_resp.ret !== 0) {
      throw new Error(`Album API returned ret=${payload.base_resp.ret}`);
    }

    const list = payload.getalbum_resp?.article_list ?? [];
    const continueFlag = payload.getalbum_resp?.continue_flag === '1';
    const articles = list
      .map((item) => {
        const publishTime = Number(item.create_time || 0);
        const title = item.title?.trim() || '';
        const url = item.url?.replace(/&amp;/g, '&') || '';

        if (!publishTime || !title || !url) {
          return null;
        }

        return {
          id: normalizeWechatArticleId(url),
          title,
          picUrl: item.cover_img_1_1 || '',
          publishTime,
        } satisfies ArticleRecord;
      })
      .filter(Boolean) as ArticleRecord[];

    return {
      articles,
      continueFlag,
      nextCursor:
        list.length > 0
          ? {
              msgId: list[list.length - 1].msgid || '',
              itemIdx: list[list.length - 1].itemidx || '',
            }
          : undefined,
    };
  }

  private async getAlbumDiscoveryArticles(
    mpId: string,
    platformArticles: ArticleRecord[],
  ) {
    if (platformArticles.length > 0) {
      return platformArticles;
    }

    return this.prismaService.article.findMany({
      where: { mpId },
      orderBy: { publishTime: 'desc' },
      take: ALBUM_DISCOVERY_SAMPLE_COUNT,
      select: {
        id: true,
        picUrl: true,
        publishTime: true,
        title: true,
      },
    });
  }

  private async getSupplementalAlbumArticles(
    mpId: string,
    platformArticles: ArticleRecord[],
  ) {
    const discoveryArticles = await this.getAlbumDiscoveryArticles(
      mpId,
      platformArticles,
    );
    if (discoveryArticles.length === 0) {
      return [] as ArticleRecord[];
    }

    const albumConfigs = await this.discoverAlbumConfigs(discoveryArticles);
    const supplemental = new Map<string, ArticleRecord>();

    for (const config of albumConfigs) {
      let cursor: { msgId: string; itemIdx: string } | undefined;
      let pageCount = 0;

      while (pageCount < ALBUM_MAX_PAGE_COUNT) {
        const page = await this.getAlbumPageArticles(config, cursor).catch(
          (error) => {
            this.logger.warn(
              `getAlbumPageArticles(${config.albumId}) failed: ${error instanceof Error ? error.message : error}`,
            );
            return null;
          },
        );

        if (!page || page.articles.length === 0) {
          break;
        }

        page.articles.forEach((article) => {
          const hasEquivalentArticle = Array.from(supplemental.values()).some(
            (existingArticle) =>
              this.isEquivalentArticle(existingArticle, article),
          );
          if (!hasEquivalentArticle) {
            supplemental.set(article.id, article);
          }
        });
        pageCount++;

        if (
          !page.continueFlag ||
          !page.nextCursor?.msgId ||
          !page.nextCursor?.itemIdx
        ) {
          break;
        }

        cursor = page.nextCursor;
      }
    }

    return Array.from(supplemental.values()).sort(
      (left, right) => right.publishTime - left.publishTime,
    );
  }

  private getArticlePublishTimeRange(articles: ArticleRecord[]) {
    if (articles.length === 0) {
      return null;
    }

    let minPublishTime = articles[0].publishTime;
    let maxPublishTime = articles[0].publishTime;

    for (const { publishTime } of articles) {
      if (publishTime < minPublishTime) {
        minPublishTime = publishTime;
      }

      if (publishTime > maxPublishTime) {
        maxPublishTime = publishTime;
      }
    }

    return { minPublishTime, maxPublishTime };
  }

  private async getExistingArticleKeys(mpId: string, articles: ArticleRecord[]) {
    if (articles.length === 0) {
      return {
        existingIds: new Set<string>(),
        nearbyArticles: [] as Pick<ArticleRecord, 'id' | 'title' | 'publishTime'>[],
      };
    }

    const timeRange = this.getArticlePublishTimeRange(articles);
    const [sameIdArticles, nearbyArticles] = await Promise.all([
      this.prismaService.article.findMany({
        where: {
          id: {
            in: articles.map(({ id }) => id),
          },
        },
        select: { id: true },
      }),
      this.prismaService.article.findMany({
        where: {
          mpId,
          publishTime: {
            gte: (timeRange?.minPublishTime ?? 0) - 300,
            lte: (timeRange?.maxPublishTime ?? 0) + 300,
          },
        },
        select: { id: true, title: true, publishTime: true },
      }),
    ]);

    return {
      existingIds: new Set(sameIdArticles.map(({ id }) => id)),
      nearbyArticles,
    };
  }

  private async deleteEquivalentExistingDuplicates(
    mpId: string,
    articles: ArticleRecord[],
    nearbyArticles: Pick<ArticleRecord, 'id' | 'title' | 'publishTime'>[],
  ) {
    const idsToDelete = new Set<string>();

    for (const article of articles) {
      nearbyArticles.forEach((existingArticle) => {
        if (
          existingArticle.id !== article.id &&
          this.isEquivalentArticle(existingArticle, article)
        ) {
          idsToDelete.add(existingArticle.id);
        }
      });
    }

    if (idsToDelete.size === 0) {
      return 0;
    }

    const result = await this.prismaService.article.deleteMany({
      where: {
        mpId,
        id: {
          in: Array.from(idsToDelete),
        },
      },
    });

    return result.count ?? 0;
  }

  async refreshMpArticlesAndUpdateFeed(
    mpId: string,
    page = 1,
    emptyRetryCount = 2,
  ): Promise<RefreshFeedResult> {
    const latestLocalArticle =
      page === 1
        ? await this.prismaService.article.findFirst({
            where: { mpId },
            orderBy: { publishTime: 'desc' },
            select: { id: true, publishTime: true },
          })
        : null;
    let platformArticles: ArticleRecord[] = [];
    let platformError: Error | null = null;

    try {
      platformArticles = await this.getMpArticles(mpId, page);
    } catch (error) {
      if (page !== 1 || !this.canFallbackToPublicAlbums(error)) {
        throw error;
      }

      platformError =
        error instanceof Error ? error : new Error(String(error ?? ''));
      this.logger.warn(
        `refreshMpArticlesAndUpdateFeed(${mpId}) falling back to public album sync: ${platformError.message}`,
      );
    }

    if (page === 1 && latestLocalArticle && platformArticles.length === 0) {
      if (!platformError && emptyRetryCount > 0) {
        this.logger.warn(
          `refreshMpArticlesAndUpdateFeed(${mpId}) received empty page 1, retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2 * 1e3));
        return this.refreshMpArticlesAndUpdateFeed(
          mpId,
          page,
          emptyRetryCount - 1,
        );
      }

      if (!platformError) {
        throw new Error(EMPTY_ARTICLES_RESPONSE_MESSAGE);
      }
    }

    const supplementalArticles =
      page === 1 ? await this.getSupplementalAlbumArticles(mpId, platformArticles) : [];
    if (platformArticles.length === 0 && supplementalArticles.length === 0) {
      if (platformError) {
        throw platformError;
      }

      if (page === 1 && latestLocalArticle) {
        throw new Error(EMPTY_ARTICLES_RESPONSE_MESSAGE);
      }
    }
    const articles = this.mergeArticleSources(
      platformArticles,
      supplementalArticles,
    );
    const { existingIds, nearbyArticles } =
      await this.getExistingArticleKeys(mpId, articles);
    const hasEquivalentExistingArticle = (article: ArticleRecord) =>
      nearbyArticles.some((existingArticle) =>
        this.isEquivalentArticle(existingArticle, article),
      );
    const newArticles = articles.filter(
      (article) =>
        !existingIds.has(article.id) && !hasEquivalentExistingArticle(article),
    );
    const syncArticles = articles.filter(
      (article) =>
        existingIds.has(article.id) || !hasEquivalentExistingArticle(article),
    );
    const insertedCount = newArticles.length;
    const latestRemotePublishTime = articles[0]?.publishTime ?? null;

    if (articles.length > 0) {
      let results;
      const { type } =
        this.configService.get<ConfigurationType['database']>('database')!;
      if (type === 'sqlite') {
        const inserts = syncArticles.map(({ id, picUrl, publishTime, title }) =>
          this.prismaService.article.upsert({
            create: { id, mpId, picUrl, publishTime, title },
            update: {
              publishTime,
              title,
            },
            where: { id },
          }),
        );
        results = await this.prismaService.$transaction(inserts);
      } else if (newArticles.length > 0) {
        results = await (this.prismaService.article as any).createMany({
          data: newArticles.map(({ id, picUrl, publishTime, title }) => ({
            id,
            mpId,
            picUrl,
            publishTime,
            title,
          })),
          skipDuplicates: true,
        });
      } else {
        results = { count: 0 };
      }
      const deletedDuplicateCount = await this.deleteEquivalentExistingDuplicates(
        mpId,
        syncArticles,
        nearbyArticles,
      );

      this.logger.debug(
        `refreshMpArticlesAndUpdateFeed(${mpId}) platform=${platformArticles.length} supplemental=${supplementalArticles.length} merged=${articles.length} inserted=${insertedCount} deletedDuplicates=${deletedDuplicateCount} results=${JSON.stringify(results)}`,
      );
    }

    const hasHistory = articles.length < defaultCount ? 0 : 1;

    await this.prismaService.feed.update({
      where: { id: mpId },
      data: {
        syncTime: Math.floor(Date.now() / 1e3),
        hasHistory,
      },
    });

    return {
      mpId,
      hasHistory,
      requestedCount: articles.length,
      insertedCount,
      latestLocalPublishTime: latestLocalArticle?.publishTime ?? null,
      latestRemotePublishTime,
    };
  }

  inProgressHistoryMp = {
    id: '',
    page: 1,
  };

  async getHistoryMpArticles(mpId: string) {
    if (this.inProgressHistoryMp.id === mpId) {
      this.logger.log(`getHistoryMpArticles(${mpId}) is running`);
      return;
    }

    this.inProgressHistoryMp = {
      id: mpId,
      page: 1,
    };

    if (!this.inProgressHistoryMp.id) {
      return;
    }

    try {
      const feed = await this.prismaService.feed.findFirstOrThrow({
        where: {
          id: mpId,
        },
      });

      if (feed.hasHistory === 0) {
        this.logger.log(`getHistoryMpArticles(${mpId}) has no history`);
        return;
      }

      const total = await this.prismaService.article.count({
        where: {
          mpId,
        },
      });
      this.inProgressHistoryMp.page = Math.ceil(total / defaultCount);

      let i = 1e3;
      while (i-- > 0) {
        if (this.inProgressHistoryMp.id !== mpId) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) is not running, break`,
          );
          break;
        }
        const { hasHistory } = await this.refreshMpArticlesAndUpdateFeed(
          mpId,
          this.inProgressHistoryMp.page,
        );
        if (hasHistory < 1) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) has no history, break`,
          );
          break;
        }
        this.inProgressHistoryMp.page++;

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.inProgressHistoryMp = {
        id: '',
        page: 1,
      };
    }
  }

  isRefreshAllMpArticlesRunning = false;

  async refreshAllMpArticlesAndUpdateFeed() {
    if (this.isRefreshAllMpArticlesRunning) {
      this.logger.log('refreshAllMpArticlesAndUpdateFeed is running');
      return {
        results: [] as RefreshFeedResult[],
        totalInsertedCount: 0,
        totalRequestedCount: 0,
      };
    }
    const mps = await this.prismaService.feed.findMany();
    this.isRefreshAllMpArticlesRunning = true;
    const results: RefreshFeedResult[] = [];
    try {
      for (const { id } of mps) {
        results.push(await this.refreshMpArticlesAndUpdateFeed(id));

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.isRefreshAllMpArticlesRunning = false;
    }

    return {
      results,
      totalInsertedCount: results.reduce(
        (total, item) => total + item.insertedCount,
        0,
      ),
      totalRequestedCount: results.reduce(
        (total, item) => total + item.requestedCount,
        0,
      ),
    };
  }

  async getMpInfo(url: string) {
    url = url.trim();
    const account = await this.getAvailableAccount();

    return this.request
      .post<
        {
          id: string;
          cover: string;
          name: string;
          intro: string;
          updateTime: number;
        }[]
      >(
        `/api/v2/platform/wxs2mp`,
        { url },
        {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
        },
      )
      .then((res) => res.data);
  }

  async createLoginUrl() {
    return this.request
      .get<{
        uuid: string;
        scanUrl: string;
      }>(`/api/v2/login/platform`)
      .then((res) => res.data);
  }

  async getLoginResult(id: string) {
    return this.request
      .get<{
        message: string;
        vid?: number;
        token?: string;
        username?: string;
      }>(`/api/v2/login/platform/${id}`, { timeout: 120 * 1e3 })
      .then((res) => res.data);
  }
}
