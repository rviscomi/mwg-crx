import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseThoughtAndContent } = require('../parser.js');
const { testSuite } = require('./tests.js');

describe('parseThoughtAndContent', () => {
  testSuite.forEach((t) => {
    it(t.name, () => {
      const actual = parseThoughtAndContent(t.input);
      expect(actual).toEqual(t.expected);
    });
  });
});
