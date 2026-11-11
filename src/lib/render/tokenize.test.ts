import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

describe('tokenize', () => {
  it('plain text is one token', () => {
    expect(tokenize('hello\nworld')).toEqual([{ type: 'text', value: 'hello\nworld' }]);
  });

  it('empty string gives no tokens', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('inline math', () => {
    expect(tokenize('a $x^2$ b')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'math', tex: 'x^2', display: false, raw: '$x^2$' },
      { type: 'text', value: ' b' },
    ]);
  });

  it('display math spanning lines', () => {
    expect(tokenize('$$a\n+b$$')).toEqual([
      { type: 'math', tex: 'a\n+b', display: true, raw: '$$a\n+b$$' },
    ]);
  });

  it('inline math does not cross a blank line', () => {
    expect(tokenize('$a\n\nb$')).toEqual([{ type: 'text', value: '$a\n\nb$' }]);
  });

  it('inline math may cross a single newline', () => {
    expect(tokenize('$a\nb$')).toEqual([
      { type: 'math', tex: 'a\nb', display: false, raw: '$a\nb$' },
    ]);
  });

  it('unmatched $ is literal', () => {
    expect(tokenize('costs $5')).toEqual([{ type: 'text', value: 'costs $5' }]);
  });

  it('\\$ is a literal dollar, merged with text', () => {
    expect(tokenize('a \\$5 and \\$6')).toEqual([{ type: 'text', value: 'a $5 and $6' }]);
  });

  it('\\$ inside math does not close it', () => {
    expect(tokenize('$a\\$b$')).toEqual([
      { type: 'math', tex: 'a\\$b', display: false, raw: '$a\\$b$' },
    ]);
  });

  it('empty inline math is literal', () => {
    expect(tokenize('$$')).toEqual([{ type: 'text', value: '$$' }]);
  });

  it('smiles without caption', () => {
    expect(tokenize('{{smiles: CCO }}')).toEqual([
      { type: 'smiles', smiles: 'CCO', caption: null, raw: '{{smiles: CCO }}' },
    ]);
  });

  it('smiles with caption', () => {
    expect(tokenize('x {{smiles:CCO| ethanol }}')).toEqual([
      { type: 'text', value: 'x ' },
      { type: 'smiles', smiles: 'CCO', caption: 'ethanol', raw: '{{smiles:CCO| ethanol }}' },
    ]);
  });

  it('smiles with empty caption has null caption', () => {
    expect(tokenize('{{smiles:CCO|  }}')).toEqual([
      { type: 'smiles', smiles: 'CCO', caption: null, raw: '{{smiles:CCO|  }}' },
    ]);
  });

  it('empty smiles is unmatched text', () => {
    expect(tokenize('{{smiles: }}')).toEqual([{ type: 'text', value: '{{smiles: }}' }]);
    expect(tokenize('{{smiles:CCO')).toEqual([{ type: 'text', value: '{{smiles:CCO' }]);
  });

  it('bare \\ce with nested braces', () => {
    expect(tokenize('ion \\ce{A^{2+}} here')).toEqual([
      { type: 'text', value: 'ion ' },
      { type: 'math', tex: '\\ce{A^{2+}}', display: false, raw: '\\ce{A^{2+}}' },
      { type: 'text', value: ' here' },
    ]);
  });

  it('bare \\pu', () => {
    expect(tokenize('\\pu{123 kJ/mol}')).toEqual([
      { type: 'math', tex: '\\pu{123 kJ/mol}', display: false, raw: '\\pu{123 kJ/mol}' },
    ]);
  });

  it('unbalanced \\ce stays text', () => {
    expect(tokenize('\\ce{H2O')).toEqual([{ type: 'text', value: '\\ce{H2O' }]);
  });

  it('\\ce inside math stays part of the math', () => {
    expect(tokenize('$\\ce{H2O}$')).toEqual([
      { type: 'math', tex: '\\ce{H2O}', display: false, raw: '$\\ce{H2O}$' },
    ]);
  });

  it('merges adjacent text tokens', () => {
    const t = tokenize('a $ b \\$ c {{smiles:}} d');
    expect(t).toEqual([{ type: 'text', value: 'a $ b $ c {{smiles:}} d' }]);
  });
});
