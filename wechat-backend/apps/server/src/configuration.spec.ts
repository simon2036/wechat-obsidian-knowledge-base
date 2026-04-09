import configuration, { parseIntegerEnv } from './configuration';

describe('configuration', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('parseIntegerEnv falls back when value is missing or invalid', () => {
    expect(parseIntegerEnv(undefined, 60)).toBe(60);
    expect(parseIntegerEnv('abc', 120)).toBe(120);
    expect(parseIntegerEnv('180', 60)).toBe(180);
  });

  it('uses numeric defaults for throttler and update delay', () => {
    delete process.env.MAX_REQUEST_PER_MINUTE;
    delete process.env.UPDATE_DELAY_TIME;

    const result = configuration();

    expect(result.throttler.maxRequestPerMinute).toBe(60);
    expect(result.feed.updateDelayTime).toBe(60);
  });
});
