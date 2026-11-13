// Writes the Terraform export of every sample lab to $TERRAFORM_OUT/<lab>/main.tf
// so CI can run the real `terraform validate` on it. The unit tests in
// src/interop/terraform.test.ts check the HCL text; only Terraform itself can
// say whether AWS resource types, arguments and references are valid.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { terraformExporter } from '../../src/interop/terraform';
import { EXAMPLES } from '../../src/model/examples';

const out = process.env.TERRAFORM_OUT;

describe('Terraform export of every sample lab', () => {
  it('has somewhere to write', () => {
    expect(out, 'set TERRAFORM_OUT to a folder').toBeTruthy();
  });

  for (const lab of EXAMPLES) {
    it(lab.id, () => {
      const { topology, layout } = lab.build();
      const result = terraformExporter.export({ topology, layout, name: lab.name });
      if (!result.text.includes('resource "aws_vpc"')) {
        // Nothing to build (e.g. an IPv6-only lab): the exporter must say why.
        expect(result.notes.length).toBeGreaterThan(0);
        return;
      }
      const dir = join(out!, lab.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'main.tf'), result.text);
    });
  }
});
