import { describe, expect, it } from 'vitest';
import { expr, hclName, hclString, renderBlock, str } from './hcl';

describe('hclString', () => {
  it('escapes quotes, backslashes and newlines', () => {
    expect(hclString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
  });
  it('neutralises template interpolation, the HCL injection vector', () => {
    expect(hclString('${file("~/.aws/credentials")}')).toBe('"$${file(\\"~/.aws/credentials\\")}"');
    expect(hclString('%{ for x in y }')).toBe('"%%{ for x in y }"');
  });
  it('leaves a lone $ or % alone', () => {
    expect(hclString('cost $5, 50%')).toBe('"cost $5, 50%"');
  });
});

describe('hclName', () => {
  it('makes a valid, unique identifier', () => {
    const used = new Set<string>();
    expect(hclName('R1 GigabitEthernet0/0.10', used)).toBe('r1_gigabitethernet0_0_10');
    expect(hclName('r1 gigabitethernet0/0.10', used)).toBe('r1_gigabitethernet0_0_10_2');
    expect(hclName('10.0.0.0/24', used)).toBe('n_10_0_0_0_24');
    expect(hclName('${evil}', used)).toBe('evil');
  });
});

describe('renderBlock', () => {
  it('aligns attributes and nests blocks like terraform fmt', () => {
    const lines = renderBlock('resource "aws_vpc" "main"', [
      ['cidr_block', str('10.0.0.0/16')],
      ['enable_dns_support', expr('true')],
      ['tags', { Name: str('lab') }],
      { block: 'lifecycle', body: [['prevent_destroy', expr('false')]] },
    ]);
    expect(lines).toEqual([
      'resource "aws_vpc" "main" {',
      '  cidr_block         = "10.0.0.0/16"',
      '  enable_dns_support = true',
      '  tags = {', // a multi-line value is not aligned with the run above it
      '    Name = "lab"',
      '  }',
      '  lifecycle {',
      '    prevent_destroy = false',
      '  }',
      '}',
    ]);
  });

  it('starts a new alignment run after a comment or a multi-line map, as terraform fmt does', () => {
    const lines = renderBlock('resource "x" "y"', [
      ['a', expr('1')],
      { comment: 'note' },
      ['longer_name', expr('2')],
      ['depends_on', [expr('z')]],
      ['tags', { Name: str('n') }],
      ['b', expr('3')],
      ['empty', {}],
    ]);
    expect(lines).toEqual([
      'resource "x" "y" {',
      '  a = 1',
      '  # note',
      '  longer_name = 2',
      '  depends_on  = [z]',
      '  tags = {',
      '    Name = "n"',
      '  }',
      '  b     = 3', // an empty map fits on one line, so it joins the run
      '  empty = {}',
      '}',
    ]);
  });
});
