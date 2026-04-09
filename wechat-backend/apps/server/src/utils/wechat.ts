export const normalizeWechatArticleId = (value: string) => {
  const normalized = value
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/#(?:rd|wechat_redirect)$/i, '');

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);

      if (parsed.hostname === 'mp.weixin.qq.com') {
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 's') {
          const tail = pathParts.slice(1).join('/');

          if (parsed.search) {
            return `s${parsed.search}`;
          }

          return tail || 's';
        }
      }
    } catch {
      // Fall through to raw string handling below.
    }
  }

  if (normalized.startsWith('/')) {
    return normalized.replace(/^\/+/, '');
  }

  if (normalized.startsWith('s/s?')) {
    return `s${normalized.slice(3)}`;
  }

  if (normalized.startsWith('s/s/')) {
    return `s/${normalized.slice(4)}`;
  }

  return normalized;
};

export const buildWechatArticleUrl = (articleId: string) => {
  const normalized = normalizeWechatArticleId(articleId);

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (
    normalized.startsWith('s?') ||
    normalized.startsWith('s/') ||
    normalized === 's'
  ) {
    if (normalized === 's') {
      return 'https://mp.weixin.qq.com/s';
    }

    return `https://mp.weixin.qq.com/${normalized}`;
  }

  if (normalized.startsWith('?')) {
    return `https://mp.weixin.qq.com/s${normalized}`;
  }

  if (normalized.startsWith('__biz=')) {
    return `https://mp.weixin.qq.com/s?${normalized}`;
  }

  return `https://mp.weixin.qq.com/s/${normalized}`;
};
