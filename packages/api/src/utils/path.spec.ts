import { logger } from '@aipyq/data-schemas';
import type { Logger } from '@aipyq/agents';
import { getBasePath } from './path';

describe('getBasePath', () => {
  let originalDomainClient: string | undefined;

  beforeEach(() => {
    originalDomainClient = process.env.DOMAIN_CLIENT;
  });

  afterEach(() => {
    process.env.DOMAIN_CLIENT = originalDomainClient;
  });

  it('should return empty string when DOMAIN_CLIENT is not set', () => {
    delete process.env.DOMAIN_CLIENT;
    expect(getBasePath()).toBe('');
  });

  it('should return empty string when DOMAIN_CLIENT is root path', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/';
    expect(getBasePath()).toBe('');
  });

  it('should return base path for subdirectory deployment', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/aipyq';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should return base path without trailing slash', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/aipyq/';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should handle nested subdirectories', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/apps/aipyq';
    expect(getBasePath()).toBe('/apps/aipyq');
  });

  it('should handle HTTPS URLs', () => {
    process.env.DOMAIN_CLIENT = 'https://example.com/aipyq';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should handle URLs with query parameters', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/aipyq?param=value';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should handle URLs with fragments', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:3080/aipyq#section';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should return empty string for invalid URL', () => {
    process.env.DOMAIN_CLIENT = 'not-a-valid-url';
    // Accepts (infoObject: object), return value is not used
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {
      return logger as unknown as Logger;
    });
    expect(getBasePath()).toBe('');
    expect(loggerSpy).toHaveBeenCalledWith(
      'Error parsing DOMAIN_CLIENT for base path:',
      expect.objectContaining({
        message: 'Invalid URL',
      }),
    );
    loggerSpy.mockRestore();
  });

  it('should handle empty string DOMAIN_CLIENT', () => {
    process.env.DOMAIN_CLIENT = '';
    expect(getBasePath()).toBe('');
  });

  it('should handle undefined DOMAIN_CLIENT', () => {
    process.env.DOMAIN_CLIENT = undefined;
    expect(getBasePath()).toBe('');
  });

  it('should handle null DOMAIN_CLIENT', () => {
    // @ts-expect-error Testing null case
    process.env.DOMAIN_CLIENT = null;
    expect(getBasePath()).toBe('');
  });

  it('should handle URLs with ports', () => {
    process.env.DOMAIN_CLIENT = 'http://localhost:8080/aipyq';
    expect(getBasePath()).toBe('/aipyq');
  });

  it('should handle URLs with subdomains', () => {
    process.env.DOMAIN_CLIENT = 'https://app.example.com/aipyq';
    expect(getBasePath()).toBe('/aipyq');
  });
});
