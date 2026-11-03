import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MEDIA_MOCK_CASES } from '../../e2e/media-mock-fixture.js';

it('registers one native iPhone counterpart for every neutral browser profile', () => {
  const source = readFileSync('tests/safari-ios/MediaProfileQATests.swift', 'utf8');
  const methods = [...source.matchAll(/func (test\w+)\(\)/g)].map((match) => match[1]);
  const expected = MEDIA_MOCK_CASES.map(
    ({ id }) =>
      `test${id
        .split('-')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')}`
  );
  expect(methods.sort()).toEqual(expected.sort());
  expect(readFileSync('tests/safari-ios/project.yml', 'utf8')).toContain(
    '- MediaProfileQATests.swift'
  );
});
