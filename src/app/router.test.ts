import { describe, expect, it } from 'vitest';
import { href, parseRoute } from './router';

describe('router', () => {
  it.each([
    ['', { page: 'home' }],
    ['#/', { page: 'home' }],
    ['#/projects', { page: 'projects' }],
    ['#/learn', { page: 'learn' }],
    ['#/workspace', { page: 'workspace', projectId: undefined }],
    ['#/workspace/abc_123', { page: 'workspace', projectId: 'abc_123' }],
    ['#/workspace/<script>', { page: 'workspace', projectId: undefined }],
    ['#/nonsense', { page: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    expect(parseRoute(href({ page: 'workspace', projectId: 'x1' }))).toEqual({ page: 'workspace', projectId: 'x1' });
  });
});
