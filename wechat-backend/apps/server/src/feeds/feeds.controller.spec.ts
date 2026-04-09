import { BadGatewayException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';

describe('FeedsController', () => {
  let controller: FeedsController;
  const feedsService = {
    updateFeed: jest.fn(),
    handleGenerateFeed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedsController],
      providers: [
        {
          provide: FeedsService,
          useValue: feedsService,
        },
      ],
    }).compile();

    controller = module.get<FeedsController>(FeedsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('awaits update=true refresh before returning feed content', async () => {
    feedsService.handleGenerateFeed.mockResolvedValue({
      content: '<rss />',
      mimeType: 'application/rss+xml',
    });

    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    } as any;

    await controller.getFeed(response, 'MP_WXS_1.rss', 10, 1, '', '', '', true);

    expect(feedsService.updateFeed).toHaveBeenCalledWith('MP_WXS_1');
    expect(feedsService.handleGenerateFeed).toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith('<rss />');
  });

  it('surfaces update failures as bad gateway errors', async () => {
    feedsService.updateFeed.mockRejectedValue(
      new Error('读书账号已失效，请重新扫码登录。'),
    );

    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    } as any;

    await expect(
      controller.getFeed(response, 'MP_WXS_1.rss', 10, 1, '', '', '', true),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
