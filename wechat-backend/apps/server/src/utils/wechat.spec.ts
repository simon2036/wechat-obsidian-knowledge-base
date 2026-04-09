import {
  buildWechatArticleUrl,
  normalizeWechatArticleId,
} from './wechat';

describe('wechat utils', () => {
  it('normalizes long-form article links into stable ids', () => {
    expect(
      normalizeWechatArticleId(
        'https://mp.weixin.qq.com/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=727fc26f0044551d226cd6c6ae37055d#wechat_redirect',
      ),
    ).toBe(
      's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=727fc26f0044551d226cd6c6ae37055d',
    );
  });

  it('builds valid WeChat URLs for both short and long article ids', () => {
    expect(buildWechatArticleUrl('RHBzsOD58D7OEBF-T5s7kA')).toBe(
      'https://mp.weixin.qq.com/s/RHBzsOD58D7OEBF-T5s7kA',
    );
    expect(
      buildWechatArticleUrl(
        'https://mp.weixin.qq.com/s/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505114&idx=1&sn=6599b0e436a6e0d5700fced794a960bd',
      ),
    ).toBe(
      'https://mp.weixin.qq.com/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505114&idx=1&sn=6599b0e436a6e0d5700fced794a960bd',
    );
    expect(
      buildWechatArticleUrl(
        's/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505114&idx=1&sn=6599b0e436a6e0d5700fced794a960bd',
      ),
    ).toBe(
      'https://mp.weixin.qq.com/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505114&idx=1&sn=6599b0e436a6e0d5700fced794a960bd',
    );
    expect(
      buildWechatArticleUrl(
        's?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=727fc26f0044551d226cd6c6ae37055d',
      ),
    ).toBe(
      'https://mp.weixin.qq.com/s?__biz=MzIwNDkxMDQ3Mg==&mid=2247505053&idx=2&sn=727fc26f0044551d226cd6c6ae37055d',
    );
  });
});
