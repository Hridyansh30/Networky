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
    ['#/playground', { page: 'workspace', projectId: undefined }],
    ['#/problems', { page: 'problems' }],
    ['#/problems/first-ping', { page: 'problem', slug: 'first-ping' }],
    ['#/problems/Bad_Slug', { page: 'problems' }],
    ['#/problems/../x', { page: 'problems' }],
    ['#/nonsense', { page: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    expect(parseRoute(href({ page: 'workspace', projectId: 'x1' }))).toEqual({ page: 'workspace', projectId: 'x1' });
    expect(href({ page: 'workspace' })).toBe('#/playground');
    expect(parseRoute(href({ page: 'problem', slug: 'static-routes' }))).toEqual({ page: 'problem', slug: 'static-routes' });
  });
});
